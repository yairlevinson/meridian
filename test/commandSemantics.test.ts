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

  it('throws on unknown action', () => {
    expect(() => getActionPlan('ardupilot', 'unknownAction')).toThrow('Unknown ArduPilot action')
  })
})
