// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Px4Dialect, PX4_MODE, px4CustomMode } from '../src/core/vehicle/dialect/Px4Dialect'
import { ArduPilotDialect } from '../src/core/vehicle/dialect/ArduPilotDialect'
import { MAV_MODE_FLAG_CUSTOM_MODE_ENABLED } from '../src/core/vehicle/dialect/VehicleDialect'
import { dialectForAutopilot } from '../src/core/vehicle/dialect'

const px4 = new Px4Dialect()
const ardu = new ArduPilotDialect()

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

// ── Dialect selection ─────────────────────────────────────────────

describe('dialectForAutopilot', () => {
  it('returns Px4Dialect for MAV_AUTOPILOT_PX4 (12)', () => {
    expect(dialectForAutopilot(12).name).toBe('px4')
  })

  it('returns ArduPilotDialect for MAV_AUTOPILOT_ARDUPILOTMEGA (3)', () => {
    expect(dialectForAutopilot(3).name).toBe('ardupilot')
  })

  it('defaults to ardupilot for unknown autopilot ids (including 0)', () => {
    expect(dialectForAutopilot(0).name).toBe('ardupilot')
  })
})

// ── PX4 mode name round-trip ──────────────────────────────────────

describe('Px4Dialect mode names', () => {
  it('resolves known display names to custom_mode', () => {
    expect(px4.modeNameToCustomMode('Mission')).toBe(PX4_MODE.MISSION)
    expect(px4.modeNameToCustomMode('Loiter')).toBe(PX4_MODE.LOITER)
    expect(px4.modeNameToCustomMode('Manual')).toBe(PX4_MODE.MANUAL)
  })

  it('returns null for unknown names', () => {
    expect(px4.modeNameToCustomMode('Bogus')).toBeNull()
  })

  it('decodes custom_mode back to Auto:* names', () => {
    expect(px4.customModeToName(PX4_MODE.MISSION)).toBe('Auto:Mission')
    expect(px4.customModeToName(PX4_MODE.RTL)).toBe('Auto:RTL')
    expect(px4.customModeToName(PX4_MODE.LAND)).toBe('Auto:Land')
  })
})

// ── PX4 action plans ──────────────────────────────────────────────

describe('Px4Dialect planners', () => {
  describe('takeoff', () => {
    it('sends NAV_TAKEOFF with NaN for unused params, then arms', () => {
      const plan = px4.planTakeoff({ altitude: 10, currentAltMsl: 50 })
      expect(plan).toHaveLength(2)

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

      expect(plan[1]!.type).toBe('arm')
    })

    it('computes AMSL altitude from current MSL + relative', () => {
      const plan = px4.planTakeoff({ altitude: 25, currentAltMsl: 100 })
      const step0 = plan[0]!
      if (step0.type === 'command') {
        expect(step0.params.p7).toBe(125)
      }
    })
  })

  describe('RTL', () => {
    it('uses mode switch to AUTO_RTL, not NAV_RETURN_TO_LAUNCH command', () => {
      const plan = px4.planRtl()
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
      const plan = px4.planLand()
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
      const plan = px4.planMissionStart()
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
      const plan = px4.planPause()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192) // MAV_CMD_DO_REPOSITION
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
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
      const plan = px4.planGoto({ lat: 32.08, lon: 34.78, alt: 100 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
        expect(step.params.p4).toBeNaN()
        expect(step.params.p5).toBe(32.08)
        expect(step.params.p6).toBe(34.78)
        expect(step.params.p7).toBe(100)
      }
    })
  })

  describe('arm/disarm', () => {
    it('arm sends COMPONENT_ARM_DISARM with p1=1', () => {
      const plan = px4.planArm()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(1)
        expect(step.params.p2).toBeUndefined()
      }
    })

    it('disarm sends COMPONENT_ARM_DISARM with p1=0', () => {
      const plan = px4.planDisarm()
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(400)
        expect(step.params.p1).toBe(0)
      }
    })
  })

  describe('force arm', () => {
    it('sends COMPONENT_ARM_DISARM with p2=21196', () => {
      const plan = px4.planForceArm()
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
      const plan = px4.planEmergencyStop()
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
      const plan = px4.planChangeAltitude({ lat: 32.08, lon: 34.78, altMsl: 125 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
        expect(step.params.p4).toBeNaN()
        expect(step.params.p5).toBeNaN()
        expect(step.params.p6).toBeNaN()
        expect(step.params.p7).toBe(125)
      }
    })
  })

  describe('changeHeading', () => {
    it('sends DO_REPOSITION with yaw in RADIANS (QGC parity, not degrees per spec)', () => {
      const plan = px4.planChangeHeading({ headingDeg: 90 })
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
      const north = px4.planChangeHeading({ headingDeg: 0 })[0]!
      const south = px4.planChangeHeading({ headingDeg: 180 })[0]!
      const west = px4.planChangeHeading({ headingDeg: 270 })[0]!
      if (north.type === 'command') expect(north.params.p4).toBeCloseTo(0, 6)
      if (south.type === 'command') expect(south.params.p4).toBeCloseTo(Math.PI, 6)
      if (west.type === 'command') expect(west.params.p4).toBeCloseTo((3 * Math.PI) / 2, 6)
    })
  })

  describe('changeSpeed', () => {
    it('sends DO_CHANGE_SPEED with speedType and speed setpoint', () => {
      const plan = px4.planChangeSpeed({ speedType: 1, speed: 12 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(178)
        expect(step.params.p1).toBe(1)
        expect(step.params.p2).toBe(12)
        expect(step.params.p3).toBe(-1)
      }
    })

    it('supports airspeed (speedType=0)', () => {
      const plan = px4.planChangeSpeed({ speedType: 0, speed: 8 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p1).toBe(0)
        expect(step.params.p2).toBe(8)
      }
    })
  })

  describe('orbit', () => {
    it('sends DO_ORBIT with positive radius for CW, negative for CCW', () => {
      const cw = px4.planOrbit({ lat: 32.08, lon: 34.78, altMsl: 120, radius: 50 })
      const ccw = px4.planOrbit({ lat: 32.08, lon: 34.78, altMsl: 120, radius: -50 })
      const cwStep = cw[0]!
      const ccwStep = ccw[0]!
      if (cwStep.type === 'command') {
        expect(cwStep.command).toBe(34)
        expect(cwStep.params.p1).toBe(50)
        expect(cwStep.params.p3).toBe(1)
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
      const plan = px4.planLandingGear({ state: 0 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(2520)
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(0)
      }
    })

    it('retract sends AIRFRAME_CONFIGURATION with p2=1', () => {
      const plan = px4.planLandingGear({ state: 1 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p1).toBe(-1)
        expect(step.params.p2).toBe(1)
      }
    })
  })
})

// ── ArduPilot mode name round-trip ────────────────────────────────

describe('ArduPilotDialect mode names', () => {
  it('resolves known display names to custom_mode', () => {
    expect(ardu.modeNameToCustomMode('Guided')).toBe(4)
    expect(ardu.modeNameToCustomMode('RTL')).toBe(6)
    expect(ardu.modeNameToCustomMode('Loiter')).toBe(5)
  })

  it('accepts numeric strings for backward compatibility', () => {
    expect(ardu.modeNameToCustomMode('4')).toBe(4)
  })

  it('returns null for unknown names', () => {
    expect(ardu.modeNameToCustomMode('not-a-mode')).toBeNull()
  })

  it('decodes custom_mode back to display names', () => {
    expect(ardu.customModeToName(4)).toBe('Guided')
    expect(ardu.customModeToName(6)).toBe('RTL')
    expect(ardu.customModeToName(999)).toBe('Unknown (999)')
  })
})

// ── ArduPilot action plans ────────────────────────────────────────

describe('ArduPilotDialect planners', () => {
  describe('takeoff', () => {
    it('sets Guided mode, arms, then sends NAV_TAKEOFF with relative altitude', () => {
      const plan = ardu.planTakeoff({ altitude: 15, currentAltMsl: 0 })
      expect(plan).toHaveLength(3)

      const step0 = plan[0]!
      expect(step0.type).toBe('command')
      if (step0.type === 'command') {
        expect(step0.command).toBe(176)
        expect(step0.params.p1).toBe(1)
        expect(step0.params.p2).toBe(4)
      }

      expect(plan[1]!.type).toBe('arm')

      const step2 = plan[2]!
      if (step2.type === 'command') {
        expect(step2.command).toBe(22)
        expect(step2.params.p7).toBe(15)
      }
    })
  })

  describe('RTL', () => {
    it('uses MAV_CMD_NAV_RETURN_TO_LAUNCH command', () => {
      const plan = ardu.planRtl()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(20)
      }
    })
  })

  describe('land', () => {
    it('uses MAV_CMD_NAV_LAND command', () => {
      const plan = ardu.planLand()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(21)
      }
    })
  })

  describe('mission start', () => {
    it('uses MAV_CMD_MISSION_START command', () => {
      const plan = ardu.planMissionStart()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(300)
      }
    })
  })

  describe('pause', () => {
    it('uses MAV_CMD_DO_PAUSE_CONTINUE with p1=0', () => {
      const plan = ardu.planPause()
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      expect(step.type).toBe('command')
      if (step.type === 'command') {
        expect(step.command).toBe(252)
        expect(step.params.p1).toBe(0)
      }
    })
  })

  describe('goto', () => {
    it('sends DO_REPOSITION with target coords', () => {
      const plan = ardu.planGoto({ lat: 32.08, lon: 34.78, alt: 100 })
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
      const plan = ardu.planChangeAltitude({ lat: 32.08, lon: 34.78, altMsl: 80 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(192)
        expect(step.params.p4).toBeNaN()
        expect(step.params.p5).toBe(32.08)
        expect(step.params.p6).toBe(34.78)
        expect(step.params.p7).toBe(80)
      }
    })
  })

  describe('changeHeading', () => {
    it('sends CONDITION_YAW with absolute angle in DEGREES (p4=0)', () => {
      const plan = ardu.planChangeHeading({ headingDeg: 135 })
      expect(plan).toHaveLength(1)
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(115)
        expect(step.params.p1).toBe(135)
        expect(step.params.p2).toBe(0)
        expect(step.params.p3).toBe(0)
        expect(step.params.p4).toBe(0)
      }
    })

    it('passes ATC_RATE_Y_MAX through as yaw rate limit', () => {
      const plan = ardu.planChangeHeading({ headingDeg: 90, yawRateLimit: 45 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.params.p2).toBe(45)
      }
    })
  })

  describe('changeSpeed', () => {
    it('sends DO_CHANGE_SPEED (same encoding as PX4)', () => {
      const plan = ardu.planChangeSpeed({ speedType: 1, speed: 10 })
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
      const plan = ardu.planOrbit({ lat: 40.0, lon: -73.0, altMsl: 50, radius: -30 })
      const step = plan[0]!
      if (step.type === 'command') {
        expect(step.command).toBe(34)
        expect(step.params.p1).toBe(-30)
        expect(step.params.p3).toBe(1)
        expect(step.params.p5).toBe(40.0)
        expect(step.params.p6).toBe(-73.0)
        expect(step.params.p7).toBe(50)
      }
    })
  })

  describe('landingGear', () => {
    it('uses AIRFRAME_CONFIGURATION same as PX4', () => {
      const deploy = ardu.planLandingGear({ state: 0 })[0]!
      const retract = ardu.planLandingGear({ state: 1 })[0]!
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
})

// ── Dialect-level behavior flags ──────────────────────────────────

describe('dialect behavior flags', () => {
  it('PX4 uses SET_MODE message', () => {
    expect(px4.usesSetModeMessage).toBe(true)
  })

  it('ArduPilot uses DO_SET_MODE command', () => {
    expect(ardu.usesSetModeMessage).toBe(false)
  })
})
