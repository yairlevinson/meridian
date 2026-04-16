// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  getActionPlan,
  PX4_MODE,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  px4CustomMode,
  PX4_CUSTOM_MAIN_MODE,
  PX4_CUSTOM_SUB_MODE_AUTO
} from '../src/main/vehicle/commandSemantics'

// ── PX4 mode encoding ─────────────────────────────────────────────

describe('PX4 custom mode encoding', () => {
  it('encodes main mode in bits 16-23', () => {
    expect(px4CustomMode(4)).toBe(4 << 16)
  })

  it('encodes sub mode in bits 24-31', () => {
    expect(px4CustomMode(4, 5)).toBe((4 << 16) | (5 << 24))
  })

  it('matches known PX4 mode values', () => {
    // These must match QGC px4_custom_mode.h
    expect(PX4_MODE.MISSION).toBe((4 << 16) | (4 << 24))
    expect(PX4_MODE.RTL).toBe((4 << 16) | (5 << 24))
    expect(PX4_MODE.LAND).toBe((4 << 16) | (6 << 24))
    expect(PX4_MODE.LOITER).toBe((4 << 16) | (3 << 24))
    expect(PX4_MODE.POSCTL).toBe(3 << 16)
    expect(PX4_MODE.MANUAL).toBe(1 << 16)
  })
})

// ── PX4 action plans ──────────────────────────────────────────────

describe('PX4 CommandSemantics', () => {
  describe('takeoff', () => {
    it('sends NAV_TAKEOFF with NaN for unused params, then arms', () => {
      const plan = getActionPlan('px4', 'takeoff', { altitude: 10, currentAltMsl: 50 })
      expect(plan).toHaveLength(2)

      // Step 1: NAV_TAKEOFF command
      const step0 = plan[0]!
      expect(step0.type).toBe('command')
      if (step0.type === 'command') {
        expect(step0.command).toBe(22) // MAV_CMD_NAV_TAKEOFF
        expect(step0.params.p1).toBe(-1)
        expect(step0.params.p4).toBeNaN()
        expect(step0.params.p5).toBeNaN()
        expect(step0.params.p6).toBeNaN()
        expect(step0.params.p7).toBe(60) // 50 + 10 = AMSL altitude
      }

      // Step 2: arm
      expect(plan[1]!.type).toBe('arm')
    })

    it('computes AMSL altitude from current MSL + relative', () => {
      const plan = getActionPlan('px4', 'takeoff', { altitude: 25, currentAltMsl: 100 })
      const step0 = plan[0]!
      if (step0.type === 'command') {
        expect(step0.params.p7).toBe(125)
      }
    })
  })

  describe('RTL', () => {
    it('uses mode switch to AUTO_RTL, not NAV_RETURN_TO_LAUNCH command', () => {
      const plan = getActionPlan('px4', 'rtl')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('mode')
      if (step.type === 'mode') {
        expect(step.baseMode).toBe(MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        expect(step.customMode).toBe(PX4_MODE.RTL)
      }
    })
  })

  describe('land', () => {
    it('uses mode switch to AUTO_LAND, not NAV_LAND command', () => {
      const plan = getActionPlan('px4', 'land')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('mode')
      if (step.type === 'mode') {
        expect(step.baseMode).toBe(MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        expect(step.customMode).toBe(PX4_MODE.LAND)
      }
    })
  })

  describe('mission start', () => {
    it('uses mode switch to AUTO_MISSION then arms', () => {
      const plan = getActionPlan('px4', 'missionStart')
      expect(plan).toHaveLength(2)
      const step0 = plan[0]!
      expect(step0.type).toBe('mode')
      if (step0.type === 'mode') {
        expect(step0.baseMode).toBe(MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        expect(step0.customMode).toBe(PX4_MODE.MISSION)
      }
      expect(plan[1]!.type).toBe('arm')
    })
  })

  describe('pause', () => {
    it('uses DO_REPOSITION with NaN, not DO_PAUSE_CONTINUE', () => {
      const plan = getActionPlan('px4', 'pause')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192) // MAV_CMD_DO_REPOSITION
        expect(step.params.p1).toBe(-1) // groundspeed: no change
        expect(step.params.p2).toBe(1) // MAV_DO_REPOSITION_FLAGS_CHANGE_MODE
        expect(step.params.p3).toBe(0)
        expect(step.params.p4).toBeNaN()
        expect(step.params.p5).toBeNaN()
        expect(step.params.p6).toBeNaN()
        expect(step.params.p7).toBeNaN()
      }
    })
  })

  describe('goto', () => {
    it('sends DO_REPOSITION with target coords and NaN yaw', () => {
      const plan = getActionPlan('px4', 'goto', { lat: 32.08, lon: 34.78, alt: 100 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192) // MAV_CMD_DO_REPOSITION
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
        expect(step.params.p4).toBeNaN() // yaw: no change
        expect(step.params.p5).toBe(32.08)
        expect(step.params.p6).toBe(34.78)
        expect(step.params.p7).toBe(100)
      }
    })
  })

  describe('arm/disarm', () => {
    it('arm sends COMPONENT_ARM_DISARM with p1=1', () => {
      const plan = getActionPlan('px4', 'arm')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(1)
        expect(step.params.p2).toBeUndefined()
      }
    })

    it('disarm sends COMPONENT_ARM_DISARM with p1=0', () => {
      const plan = getActionPlan('px4', 'disarm')
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(0)
      }
    })
  })

  describe('force arm', () => {
    // Intentionally uses 21196 (MAVLink spec), differs from QGC legacy 2989
    it('sends COMPONENT_ARM_DISARM with p2=21196', () => {
      const plan = getActionPlan('px4', 'forceArm')
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(1)
        expect(step.params.p2).toBe(21196)
      }
    })
  })

  describe('emergency stop', () => {
    it('sends forced disarm with p2=21196', () => {
      const plan = getActionPlan('px4', 'emergencyStop')
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(0)
        expect(step.params.p2).toBe(21196)
      }
    })
  })

  describe('changeAltitude', () => {
    it('sends DO_REPOSITION with NaN lat/lon (hold) and new AMSL altitude', () => {
      const plan = getActionPlan('px4', 'changeAltitude', { lat: 32.08, lon: 34.78, altMsl: 125 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192) // MAV_CMD_DO_REPOSITION
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
        expect(step.params.p4).toBeNaN() // yaw hold
        expect(step.params.p5).toBeNaN() // lat hold
        expect(step.params.p6).toBeNaN() // lon hold
        expect(step.params.p7).toBe(125) // new AMSL alt
      }
    })
  })

  describe('changeHeading', () => {
    it('sends DO_REPOSITION with yaw in RADIANS (QGC parity, not degrees per spec)', () => {
      const plan = getActionPlan('px4', 'changeHeading', { headingDeg: 90 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p4).toBeCloseTo(Math.PI / 2, 6)
        expect(step.params.p5).toBeNaN()
        expect(step.params.p6).toBeNaN()
        expect(step.params.p7).toBeNaN()
      }
    })

    it('encodes 0° as 0 rad, 180° as π rad, 270° as 3π/2 rad', () => {
      const north = getActionPlan('px4', 'changeHeading', { headingDeg: 0 })[0]!
      const south = getActionPlan('px4', 'changeHeading', { headingDeg: 180 })[0]!
      const west = getActionPlan('px4', 'changeHeading', { headingDeg: 270 })[0]!
      if (north.type === 'command') expect(north.params.p4).toBeCloseTo(0, 6)
      if (south.type === 'command') expect(south.params.p4).toBeCloseTo(Math.PI, 6)
      if (west.type === 'command') expect(west.params.p4).toBeCloseTo((3 * Math.PI) / 2, 6)
    })
  })

  describe('changeSpeed', () => {
    it('sends DO_CHANGE_SPEED with speedType and speed setpoint', () => {
      const plan = getActionPlan('px4', 'changeSpeed', { speedType: 1, speed: 12 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(178) // MAV_CMD_DO_CHANGE_SPEED
        expect(step.params.p1).toBe(1) // groundspeed
        expect(step.params.p2).toBe(12)
        expect(step.params.p3).toBe(-1) // throttle unchanged
      }
    })

    it('supports airspeed (speedType=0)', () => {
      const plan = getActionPlan('px4', 'changeSpeed', { speedType: 0, speed: 8 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p1).toBe(0)
        expect(step.params.p2).toBe(8)
      }
    })
  })

  describe('orbit', () => {
    it('sends DO_ORBIT with positive radius for CW, negative for CCW', () => {
      const cw = getActionPlan('px4', 'orbit', {
        lat: 32.08,
        lon: 34.78,
        altMsl: 120,
        radius: 50
      })
      const ccw = getActionPlan('px4', 'orbit', {
        lat: 32.08,
        lon: 34.78,
        altMsl: 120,
        radius: -50
      })
      const cwStep = cw[0]!
      const ccwStep = ccw[0]!
      if (cwStep.type === 'command') {
        expect(cwStep.command).toBe(34) // MAV_CMD_DO_ORBIT
        expect(cwStep.params.p1).toBe(50)
        expect(cwStep.params.p3).toBe(1) // ORBIT_YAW_BEHAVIOUR_UNCHANGED
        expect(cwStep.params.p5).toBe(32.08)
        expect(cwStep.params.p6).toBe(34.78)
        expect(cwStep.params.p7).toBe(120)
      }
      if (ccwStep.type === 'command') {
        expect(ccwStep.params.p1).toBe(-50)
      }
    })
  })

  describe('landingGear', () => {
    it('deploy sends AIRFRAME_CONFIGURATION with p2=0', () => {
      const plan = getActionPlan('px4', 'landingGear', { state: 0 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(2520) // MAV_CMD_AIRFRAME_CONFIGURATION
        expect(step.params.p1).toBe(-1) // all gears
        expect(step.params.p2).toBe(0) // down / deploy
      }
    })

    it('retract sends AIRFRAME_CONFIGURATION with p2=1', () => {
      const plan = getActionPlan('px4', 'landingGear', { state: 1 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
      }
    })
  })

  it('throws on unknown action', () => {
    expect(() => getActionPlan('px4', 'unknownAction')).toThrow('Unknown PX4 action')
  })
})

// ── ArduPilot action plans ────────────────────────────────────────

describe('ArduPilot CommandSemantics', () => {
  describe('takeoff', () => {
    it('sets Guided mode, arms, then sends NAV_TAKEOFF with relative altitude', () => {
      const plan = getActionPlan('ardupilot', 'takeoff', { altitude: 15, currentAltMsl: 0 })
      expect(plan).toHaveLength(3)

      // Step 1: DO_SET_MODE to Guided
      const step0 = plan[0]!
      expect(step0.type).toBe('command')
      if (step0.type === 'command') {
        expect(step0.command).toBe(176) // MAV_CMD_DO_SET_MODE
        expect(step0.params.p1).toBe(1) // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
        expect(step0.params.p2).toBe(4) // ArduCopter Guided mode
      }

      // Step 2: arm
      expect(plan[1]!.type).toBe('arm')

      // Step 3: NAV_TAKEOFF with relative altitude
      const step2 = plan[2]!
      if (step2.type === 'command') {
        expect(step2.command).toBe(22)
        expect(step2.params.p7).toBe(15) // relative altitude, not AMSL
      }
    })
  })

  describe('RTL', () => {
    it('uses MAV_CMD_NAV_RETURN_TO_LAUNCH command', () => {
      const plan = getActionPlan('ardupilot', 'rtl')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(20) // MAV_CMD_NAV_RETURN_TO_LAUNCH
      }
    })
  })

  describe('land', () => {
    it('uses MAV_CMD_NAV_LAND command', () => {
      const plan = getActionPlan('ardupilot', 'land')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(21) // MAV_CMD_NAV_LAND
      }
    })
  })

  describe('mission start', () => {
    it('uses MAV_CMD_MISSION_START command', () => {
      const plan = getActionPlan('ardupilot', 'missionStart')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(300) // MAV_CMD_MISSION_START
      }
    })
  })

  describe('pause', () => {
    it('uses MAV_CMD_DO_PAUSE_CONTINUE with p1=0', () => {
      const plan = getActionPlan('ardupilot', 'pause')
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(252) // MAV_CMD_DO_PAUSE_CONTINUE
        expect(step.params.p1).toBe(0)
      }
    })
  })

  describe('goto', () => {
    it('sends DO_REPOSITION with target coords', () => {
      const plan = getActionPlan('ardupilot', 'goto', { lat: 32.08, lon: 34.78, alt: 100 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p5).toBe(32.08)
        expect(step.params.p6).toBe(34.78)
        expect(step.params.p7).toBe(100)
      }
    })
  })

  describe('changeAltitude', () => {
    it('sends DO_REPOSITION with current lat/lon and new AMSL altitude', () => {
      const plan = getActionPlan('ardupilot', 'changeAltitude', {
        lat: 32.08,
        lon: 34.78,
        altMsl: 80
      })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p4).toBeNaN()
        // ArduPilot wants real lat/lon (unlike PX4's NaN hold)
        expect(step.params.p5).toBe(32.08)
        expect(step.params.p6).toBe(34.78)
        expect(step.params.p7).toBe(80)
      }
    })
  })

  describe('changeHeading', () => {
    it('sends CONDITION_YAW with absolute angle in DEGREES (p4=0)', () => {
      const plan = getActionPlan('ardupilot', 'changeHeading', { headingDeg: 135 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(115) // MAV_CMD_CONDITION_YAW
        expect(step.params.p1).toBe(135) // degrees, not radians
        expect(step.params.p2).toBe(0) // default yaw rate
        expect(step.params.p3).toBe(0) // shortest path
        expect(step.params.p4).toBe(0) // 0 = absolute
      }
    })

    it('passes ATC_RATE_Y_MAX through as yaw rate limit', () => {
      const plan = getActionPlan('ardupilot', 'changeHeading', {
        headingDeg: 90,
        yawRateLimit: 45
      })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p2).toBe(45)
      }
    })
  })

  describe('changeSpeed', () => {
    it('sends DO_CHANGE_SPEED (same encoding as PX4)', () => {
      const plan = getActionPlan('ardupilot', 'changeSpeed', { speedType: 1, speed: 10 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(178)
        expect(step.params.p1).toBe(1)
        expect(step.params.p2).toBe(10)
        expect(step.params.p3).toBe(-1)
      }
    })
  })

  describe('orbit', () => {
    it('sends DO_ORBIT with signed radius for direction', () => {
      const plan = getActionPlan('ardupilot', 'orbit', {
        lat: 40.0,
        lon: -73.0,
        altMsl: 50,
        radius: -30
      })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(34)
        expect(step.params.p1).toBe(-30) // CCW
        expect(step.params.p3).toBe(1) // yaw unchanged
        expect(step.params.p5).toBe(40.0)
        expect(step.params.p6).toBe(-73.0)
        expect(step.params.p7).toBe(50)
      }
    })
  })

  describe('landingGear', () => {
    it('uses AIRFRAME_CONFIGURATION same as PX4', () => {
      const deploy = getActionPlan('ardupilot', 'landingGear', { state: 0 })[0]!
      const retract = getActionPlan('ardupilot', 'landingGear', { state: 1 })[0]!
      if (deploy.type === 'command') {
        expect(deploy.command).toBe(2520)
        expect(deploy.params.p1).toBe(-1)
        expect(deploy.params.p2).toBe(0)
      }
      if (retract.type === 'command') {
        expect(retract.params.p2).toBe(1)
      }
    })
  })

  it('throws on unknown action', () => {
    expect(() => getActionPlan('ardupilot', 'unknownAction')).toThrow('Unknown ArduPilot action')
  })
})
