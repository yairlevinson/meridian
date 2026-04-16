/**
 * CommandSemantics — autopilot-aware command encoding for guided actions.
 *
 * Encodes the correct MAVLink command parameters and sequencing per autopilot
 * family (PX4 vs ArduPilot). This is the single source of truth for "what
 * wire-level commands does action X require on autopilot Y?"
 *
 * Design: semantic intents → autopilot-specific resolvers → wire-level commands.
 * No mode display strings leak into this layer — only numeric base/custom mode values.
 */

// ── PX4 custom_mode encoding ──────────────────────────────────────
// Matches QGC px4_custom_mode.h: main_mode in bits 16-23, sub_mode in bits 24-31

export const PX4_CUSTOM_MAIN_MODE = {
  MANUAL: 1,
  ALTCTL: 2,
  POSCTL: 3,
  AUTO: 4,
  ACRO: 5,
  OFFBOARD: 6,
  STABILIZED: 7
} as const

export const PX4_CUSTOM_SUB_MODE_AUTO = {
  READY: 1,
  TAKEOFF: 2,
  LOITER: 3,
  MISSION: 4,
  RTL: 5,
  LAND: 6,
  FOLLOW_TARGET: 8,
  PRECLAND: 9
} as const

/** Encode PX4 main + sub mode into the 32-bit custom_mode field */
export function px4CustomMode(main: number, sub = 0): number {
  return (main << 16) | (sub << 24)
}

// Pre-computed PX4 mode values used by action plans
export const PX4_MODE = {
  MISSION: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.MISSION),
  RTL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.RTL),
  LAND: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.LAND),
  LOITER: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.LOITER),
  POSCTL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.POSCTL),
  MANUAL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.MANUAL)
} as const

// MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1 (bit 0)
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1

// ── Action step types ─────────────────────────────────────────────

export interface CommandStep {
  type: 'command'
  command: number
  params: {
    p1?: number
    p2?: number
    p3?: number
    p4?: number
    p5?: number
    p6?: number
    p7?: number
  }
}

export interface ModeStep {
  type: 'mode'
  /** base_mode for SET_MODE message (always MAV_MODE_FLAG_CUSTOM_MODE_ENABLED for PX4) */
  baseMode: number
  /** custom_mode for SET_MODE message */
  customMode: number
}

export interface ArmStep {
  type: 'arm'
}

export type ActionStep = CommandStep | ModeStep | ArmStep

// ── Action plan resolution ────────────────────────────────────────

export type AutopilotType = 'px4' | 'ardupilot'

export interface TakeoffParams {
  altitude: number
  currentAltMsl: number
}

export interface GotoParams {
  lat: number
  lon: number
  alt: number // AMSL
}

export interface ChangeAltitudeParams {
  /** Current latitude (degrees) — PX4 accepts NaN to hold, but ArduPilot Copter treats NaN as reject */
  lat: number
  lon: number
  /** New target altitude AMSL (meters) */
  altMsl: number
}

export interface ChangeHeadingParams {
  /** Target heading in degrees (0-360, 0 = north, CW positive) */
  headingDeg: number
  /** For ArduPilot CONDITION_YAW: signed shortest-path delta in degrees (negative = CCW) */
  deltaDeg?: number
  /** ArduPilot yaw rate limit (deg/s, from ATC_RATE_Y_MAX), 0 = autopilot default */
  yawRateLimit?: number
}

export interface ChangeSpeedParams {
  /** 0 = airspeed, 1 = groundspeed */
  speedType: number
  /** Speed setpoint in m/s */
  speed: number
}

export interface OrbitParams {
  lat: number
  lon: number
  /** AMSL altitude (meters) */
  altMsl: number
  /** Radius in meters. Negative = counter-clockwise (QGC convention for orbit direction) */
  radius: number
}

export interface LandingGearParams {
  /** 0 = deploy/down, 1 = retract/up */
  state: number
}

/**
 * Get the action plan for a guided action on the specified autopilot.
 *
 * Returns an ordered array of steps. The caller (Vehicle.ts) executes them
 * sequentially, waiting for ACK after each command step before proceeding.
 */
export function getActionPlan(
  autopilot: AutopilotType,
  action: string,
  params: Record<string, number> = {}
): ActionStep[] {
  if (autopilot === 'px4') {
    return getPx4ActionPlan(action, params)
  }
  return getArduPilotActionPlan(action, params)
}

// ── PX4 action plans ──────────────────────────────────────────────
// Reference: QGC PX4FirmwarePlugin.cc

function getPx4ActionPlan(action: string, params: Record<string, number>): ActionStep[] {
  switch (action) {
    case 'takeoff': {
      // QGC PX4FirmwarePlugin::guidedModeTakeoff:
      // NAV_TAKEOFF with AMSL altitude, NaN for unused, then arm on ACK
      const alt = params.altitude ?? 10
      const currentMsl = params.currentAltMsl ?? 0
      return [
        {
          type: 'command',
          command: 22, // MAV_CMD_NAV_TAKEOFF
          params: { p1: -1, p4: NaN, p5: NaN, p6: NaN, p7: currentMsl + alt }
        },
        { type: 'arm' }
      ]
    }

    case 'rtl':
      // QGC PX4FirmwarePlugin::guidedModeRTL: mode switch to AUTO_RTL
      // Does NOT use MAV_CMD_NAV_RETURN_TO_LAUNCH
      return [
        { type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.RTL }
      ]

    case 'land':
      // QGC PX4FirmwarePlugin::guidedModeLand: mode switch to AUTO_LAND
      // Does NOT use MAV_CMD_NAV_LAND
      return [
        { type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.LAND }
      ]

    case 'missionStart':
      // QGC PX4FirmwarePlugin::startMission: mode switch to AUTO_MISSION, then arm
      // Does NOT use MAV_CMD_MISSION_START
      return [
        { type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.MISSION },
        { type: 'arm' }
      ]

    case 'pause':
      // QGC PX4FirmwarePlugin::pauseVehicle: DO_REPOSITION with all NaN position params
      // Does NOT use MAV_CMD_DO_PAUSE_CONTINUE
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: NaN, p6: NaN, p7: NaN }
        }
      ]

    case 'goto': {
      // QGC PX4FirmwarePlugin::guidedModeGotoLocation: DO_REPOSITION with target coords
      const { lat, lon, alt } = params as unknown as GotoParams
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: lat, p6: lon, p7: alt }
        }
      ]
    }

    case 'arm':
      return [
        {
          type: 'command',
          command: 400, // MAV_CMD_COMPONENT_ARM_DISARM
          params: { p1: 1 }
        }
      ]

    case 'disarm':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 0 }
        }
      ]

    case 'forceArm':
      return [
        {
          type: 'command',
          command: 400,
          // 21196 is the MAVLink spec value for force arm (intentionally differs from QGC legacy 2989)
          params: { p1: 1, p2: 21196 }
        }
      ]

    case 'emergencyStop':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 0, p2: 21196 }
        }
      ]

    case 'changeAltitude': {
      // QGC PX4FirmwarePlugin::guidedModeChangeAltitude → _changeAltAfterPause:
      // DO_REPOSITION with NaN for yaw/lat/lon (hold) and new AMSL altitude in p7.
      const { altMsl } = params as unknown as ChangeAltitudeParams
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: NaN, p6: NaN, p7: altMsl }
        }
      ]
    }

    case 'changeHeading': {
      // QGC PX4FirmwarePlugin::guidedModeChangeHeading: DO_REPOSITION with yaw in radians.
      // PX4 firmware specifically accepts radians here (spec says degrees, but QGC sends
      // radians and PX4 works with that — matching QGC to preserve parity).
      const { headingDeg } = params as unknown as ChangeHeadingParams
      const rad = (headingDeg * Math.PI) / 180
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p3: 0, p4: rad, p5: NaN, p6: NaN, p7: NaN }
        }
      ]
    }

    case 'changeSpeed': {
      // MAV_CMD_DO_CHANGE_SPEED — shared between PX4 and ArduPilot
      const { speedType, speed } = params as unknown as ChangeSpeedParams
      return [
        {
          type: 'command',
          command: 178, // MAV_CMD_DO_CHANGE_SPEED
          params: { p1: speedType, p2: speed, p3: -1, p4: 0, p5: NaN, p6: NaN, p7: NaN }
        }
      ]
    }

    case 'orbit': {
      // QGC Vehicle::guidedModeOrbit → MAV_CMD_DO_ORBIT.
      // Negative radius = CCW per MAVLink spec.
      // ORBIT_YAW_BEHAVIOUR_UNCHANGED = 1 (keep current yaw mode)
      const { lat, lon, altMsl, radius } = params as unknown as OrbitParams
      return [
        {
          type: 'command',
          command: 34, // MAV_CMD_DO_ORBIT
          params: { p1: radius, p2: NaN, p3: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
        }
      ]
    }

    case 'landingGear': {
      // QGC Vehicle::landingGearDeploy/Retract: MAV_CMD_AIRFRAME_CONFIGURATION
      // p1 = -1 (all gears), p2 = 0 (down/deploy) or 1 (up/retract)
      const { state } = params as unknown as LandingGearParams
      return [
        {
          type: 'command',
          command: 2520, // MAV_CMD_AIRFRAME_CONFIGURATION
          params: { p1: -1, p2: state }
        }
      ]
    }

    default:
      throw new Error(`Unknown PX4 action: ${action}`)
  }
}

// ── ArduPilot action plans ────────────────────────────────────────
// ArduPilot uses COMMAND_LONG for most actions, DO_SET_MODE for mode switches

function getArduPilotActionPlan(action: string, params: Record<string, number>): ActionStep[] {
  switch (action) {
    case 'takeoff': {
      // ArduPilot: set Guided mode → arm → NAV_TAKEOFF with relative altitude
      const alt = params.altitude ?? 10
      return [
        {
          type: 'command',
          command: 176, // MAV_CMD_DO_SET_MODE
          params: { p1: 1, p2: 4 } // base_mode=CUSTOM, custom_mode=4 (Guided)
        },
        { type: 'arm' },
        {
          type: 'command',
          command: 22, // MAV_CMD_NAV_TAKEOFF
          params: { p7: alt }
        }
      ]
    }

    case 'rtl':
      // ArduPilot: MAV_CMD_NAV_RETURN_TO_LAUNCH
      return [
        {
          type: 'command',
          command: 20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
          params: {}
        }
      ]

    case 'land':
      // ArduPilot: MAV_CMD_NAV_LAND
      return [
        {
          type: 'command',
          command: 21, // MAV_CMD_NAV_LAND
          params: {}
        }
      ]

    case 'missionStart':
      // ArduPilot: MAV_CMD_MISSION_START
      return [
        {
          type: 'command',
          command: 300, // MAV_CMD_MISSION_START
          params: {}
        }
      ]

    case 'pause':
      // ArduPilot: MAV_CMD_DO_PAUSE_CONTINUE with p1=0 (pause)
      return [
        {
          type: 'command',
          command: 252, // MAV_CMD_DO_PAUSE_CONTINUE
          params: { p1: 0 }
        }
      ]

    case 'goto': {
      const { lat, lon, alt } = params as unknown as GotoParams
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p4: NaN, p5: lat, p6: lon, p7: alt }
        }
      ]
    }

    case 'arm':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 1 }
        }
      ]

    case 'disarm':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 0 }
        }
      ]

    case 'forceArm':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 1, p2: 21196 }
        }
      ]

    case 'emergencyStop':
      return [
        {
          type: 'command',
          command: 400,
          params: { p1: 0, p2: 21196 }
        }
      ]

    case 'changeAltitude': {
      // ArduPilot Copter accepts DO_REPOSITION in Guided mode with current lat/lon
      // and new altitude. (QGC uses SET_POSITION_TARGET_LOCAL_NED with LOCAL_OFFSET_NED
      // frame; DO_REPOSITION is simpler and supported by ArduPilot Copter 4.0+.)
      const { lat, lon, altMsl } = params as unknown as ChangeAltitudeParams
      return [
        {
          type: 'command',
          command: 192, // MAV_CMD_DO_REPOSITION
          params: { p1: -1, p2: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
        }
      ]
    }

    case 'changeHeading': {
      // QGC APMFirmwarePlugin::guidedModeChangeHeading: CONDITION_YAW with
      // absolute heading (p4=0 means absolute, not relative).
      const { headingDeg, yawRateLimit = 0 } = params as unknown as ChangeHeadingParams
      return [
        {
          type: 'command',
          command: 115, // MAV_CMD_CONDITION_YAW
          params: {
            p1: headingDeg,
            p2: yawRateLimit,
            p3: 0, // direction: 0 = shortest path (when p4=0 absolute)
            p4: 0 // 0 = absolute angle, 1 = relative
          }
        }
      ]
    }

    case 'changeSpeed': {
      const { speedType, speed } = params as unknown as ChangeSpeedParams
      return [
        {
          type: 'command',
          command: 178, // MAV_CMD_DO_CHANGE_SPEED
          params: { p1: speedType, p2: speed, p3: -1, p4: 0, p5: NaN, p6: NaN, p7: NaN }
        }
      ]
    }

    case 'orbit': {
      const { lat, lon, altMsl, radius } = params as unknown as OrbitParams
      return [
        {
          type: 'command',
          command: 34, // MAV_CMD_DO_ORBIT
          params: { p1: radius, p2: NaN, p3: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
        }
      ]
    }

    case 'landingGear': {
      const { state } = params as unknown as LandingGearParams
      return [
        {
          type: 'command',
          command: 2520, // MAV_CMD_AIRFRAME_CONFIGURATION
          params: { p1: -1, p2: state }
        }
      ]
    }

    default:
      throw new Error(`Unknown ArduPilot action: ${action}`)
  }
}
