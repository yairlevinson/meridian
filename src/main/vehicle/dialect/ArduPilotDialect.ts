/**
 * ArduPilot (Copter) dialect.
 *
 * ArduPilot primarily uses COMMAND_LONG for guided actions and DO_SET_MODE
 * (command 176) for mode switching — unlike PX4, which prefers mode-switch
 * messages and DO_REPOSITION for most in-flight changes.
 *
 * Reference: QGC APMFirmwarePlugin.cc.
 */

import type {
  ActionStep,
  ChangeAltitudeParams,
  ChangeHeadingParams,
  ChangeSpeedParams,
  GotoParams,
  LandingGearParams,
  OrbitParams,
  TakeoffParams,
  VehicleDialect
} from './VehicleDialect'

// ArduCopter custom_mode values (name → number)
const ARDUPILOT_NAME_TO_MODE: Record<string, number> = {
  Stabilize: 0,
  Acro: 1,
  AltHold: 2,
  Auto: 3,
  Guided: 4,
  Loiter: 5,
  RTL: 6,
  Circle: 7,
  Land: 9,
  Drift: 11,
  Sport: 13,
  Flip: 14,
  AutoTune: 15,
  PosHold: 16,
  Brake: 17,
  Throw: 18,
  Avoid: 19,
  GuidedNoGPS: 20,
  SmartRTL: 21
}

// Inverse for heartbeat decoding
const ARDUPILOT_MODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(ARDUPILOT_NAME_TO_MODE).map(([name, n]) => [n, name])
)

export class ArduPilotDialect implements VehicleDialect {
  readonly name = 'ardupilot' as const
  readonly usesSetModeMessage = false

  modeNameToCustomMode(name: string): number | null {
    const num = ARDUPILOT_NAME_TO_MODE[name]
    if (num !== undefined) return num
    // Accept numeric strings for backward compatibility
    const parsed = Number(name)
    return Number.isFinite(parsed) ? parsed : null
  }

  customModeToName(customMode: number): string {
    return ARDUPILOT_MODE_NAMES[customMode] ?? `Unknown (${customMode})`
  }

  planArm(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 1 } }]
  }

  planDisarm(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 0 } }]
  }

  planForceArm(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 1, p2: 21196 } }]
  }

  planEmergencyStop(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 0, p2: 21196 } }]
  }

  planTakeoff({ altitude }: TakeoffParams): ActionStep[] {
    // ArduPilot: set Guided mode → arm → NAV_TAKEOFF with relative altitude.
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
        params: { p7: altitude }
      }
    ]
  }

  planRtl(): ActionStep[] {
    return [{ type: 'command', command: 20, params: {} }] // MAV_CMD_NAV_RETURN_TO_LAUNCH
  }

  planLand(): ActionStep[] {
    return [{ type: 'command', command: 21, params: {} }] // MAV_CMD_NAV_LAND
  }

  planMissionStart(): ActionStep[] {
    return [{ type: 'command', command: 300, params: {} }] // MAV_CMD_MISSION_START
  }

  planPause(): ActionStep[] {
    return [{ type: 'command', command: 252, params: { p1: 0 } }] // MAV_CMD_DO_PAUSE_CONTINUE
  }

  planGoto({ lat, lon, alt }: GotoParams): ActionStep[] {
    return [
      {
        type: 'command',
        command: 192, // MAV_CMD_DO_REPOSITION
        params: { p1: -1, p2: 1, p4: NaN, p5: lat, p6: lon, p7: alt }
      }
    ]
  }

  planChangeAltitude({ lat, lon, altMsl }: ChangeAltitudeParams): ActionStep[] {
    // ArduPilot Copter accepts DO_REPOSITION in Guided mode with current lat/lon and new altitude.
    // (QGC uses SET_POSITION_TARGET_LOCAL_NED with LOCAL_OFFSET_NED frame; DO_REPOSITION is simpler
    // and supported by ArduPilot Copter 4.0+.)
    return [
      {
        type: 'command',
        command: 192,
        params: { p1: -1, p2: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
      }
    ]
  }

  planChangeHeading({ headingDeg, yawRateLimit = 0 }: ChangeHeadingParams): ActionStep[] {
    // QGC APMFirmwarePlugin::guidedModeChangeHeading: CONDITION_YAW with absolute heading
    // (p4=0 means absolute, not relative).
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

  planChangeSpeed({ speedType, speed }: ChangeSpeedParams): ActionStep[] {
    return [
      {
        type: 'command',
        command: 178,
        params: { p1: speedType, p2: speed, p3: -1, p4: 0, p5: NaN, p6: NaN, p7: NaN }
      }
    ]
  }

  planOrbit({ lat, lon, altMsl, radius }: OrbitParams): ActionStep[] {
    return [
      {
        type: 'command',
        command: 34,
        params: { p1: radius, p2: NaN, p3: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
      }
    ]
  }

  planLandingGear({ state }: LandingGearParams): ActionStep[] {
    return [
      {
        type: 'command',
        command: 2520,
        params: { p1: -1, p2: state }
      }
    ]
  }
}
