/**
 * PX4 dialect.
 *
 * References:
 *   - QGC PX4FirmwarePlugin.cc for guided-mode action encodings
 *   - QGC px4_custom_mode.h for the main/sub-mode bit layout
 *
 * custom_mode is a 32-bit field: main_mode in bits 16-23, sub_mode in bits 24-31.
 */

import {
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  type ActionStep,
  type ChangeAltitudeParams,
  type ChangeHeadingParams,
  type ChangeSpeedParams,
  type GotoParams,
  type LandingGearParams,
  type OrbitParams,
  type TakeoffParams,
  type VehicleDialect
} from './VehicleDialect'

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

export function px4CustomMode(main: number, sub = 0): number {
  return (main << 16) | (sub << 24)
}

/** Pre-computed custom_mode values for the handful used by action plans and mode switching. */
export const PX4_MODE = {
  MISSION: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.MISSION),
  RTL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.RTL),
  LAND: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.LAND),
  LOITER: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.LOITER),
  TAKEOFF: px4CustomMode(PX4_CUSTOM_MAIN_MODE.AUTO, PX4_CUSTOM_SUB_MODE_AUTO.TAKEOFF),
  POSCTL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.POSCTL),
  MANUAL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.MANUAL),
  ALTCTL: px4CustomMode(PX4_CUSTOM_MAIN_MODE.ALTCTL),
  STABILIZED: px4CustomMode(PX4_CUSTOM_MAIN_MODE.STABILIZED),
  ACRO: px4CustomMode(PX4_CUSTOM_MAIN_MODE.ACRO, 1),
  OFFBOARD: px4CustomMode(PX4_CUSTOM_MAIN_MODE.OFFBOARD),
  RATTITUDE: px4CustomMode(8)
} as const

// Display name → custom_mode for PX4 mode-switch requests
const PX4_NAME_TO_MODE: Record<string, number> = {
  Manual: PX4_MODE.MANUAL,
  AltCtl: PX4_MODE.ALTCTL,
  PosCtl: PX4_MODE.POSCTL,
  Stabilized: PX4_MODE.STABILIZED,
  Acro: PX4_MODE.ACRO,
  Offboard: PX4_MODE.OFFBOARD,
  Rattitude: PX4_MODE.RATTITUDE,
  Mission: PX4_MODE.MISSION,
  Loiter: PX4_MODE.LOITER,
  RTL: PX4_MODE.RTL,
  Land: PX4_MODE.LAND,
  Takeoff: PX4_MODE.TAKEOFF
}

// custom_mode main/sub → display name
const PX4_MODE_NAMES: Record<number, Record<number, string>> = {
  1: { 0: 'Manual' },
  2: { 0: 'AltCtl' },
  3: { 0: 'PosCtl' },
  4: {
    1: 'Auto:Ready',
    2: 'Auto:Takeoff',
    3: 'Auto:Loiter',
    4: 'Auto:Mission',
    5: 'Auto:RTL',
    6: 'Auto:Land'
  },
  5: { 1: 'Acro' },
  6: { 0: 'Offboard' },
  7: { 0: 'Stabilized' },
  8: { 0: 'Rattitude' }
}

export class Px4Dialect implements VehicleDialect {
  readonly name = 'px4' as const
  readonly usesSetModeMessage = true

  modeNameToCustomMode(name: string): number | null {
    return PX4_NAME_TO_MODE[name] ?? null
  }

  customModeToName(customMode: number): string {
    const mainMode = (customMode >> 16) & 0xff
    const subMode = (customMode >> 24) & 0xff
    const sub = PX4_MODE_NAMES[mainMode]
    if (sub) return sub[subMode] ?? sub[0] ?? `PX4:${mainMode}.${subMode}`
    return `Unknown (${customMode})`
  }

  planArm(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 1 } }]
  }

  planDisarm(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 0 } }]
  }

  planForceArm(): ActionStep[] {
    // 21196 is the MAVLink spec value for force arm (intentionally differs from QGC legacy 2989)
    return [{ type: 'command', command: 400, params: { p1: 1, p2: 21196 } }]
  }

  planEmergencyStop(): ActionStep[] {
    return [{ type: 'command', command: 400, params: { p1: 0, p2: 21196 } }]
  }

  planTakeoff({ altitude, currentAltMsl }: TakeoffParams): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeTakeoff: NAV_TAKEOFF with AMSL altitude, NaN for unused,
    // then arm on ACK.
    return [
      {
        type: 'command',
        command: 22, // MAV_CMD_NAV_TAKEOFF
        params: { p1: -1, p4: NaN, p5: NaN, p6: NaN, p7: currentAltMsl + altitude }
      },
      { type: 'arm' }
    ]
  }

  planRtl(): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeRTL: mode switch to AUTO_RTL (no NAV_RETURN_TO_LAUNCH).
    return [{ type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.RTL }]
  }

  planLand(): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeLand: mode switch to AUTO_LAND (no NAV_LAND).
    return [
      { type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.LAND }
    ]
  }

  planMissionStart(): ActionStep[] {
    // QGC PX4FirmwarePlugin::startMission: mode switch to AUTO_MISSION, then arm (no MISSION_START).
    return [
      { type: 'mode', baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode: PX4_MODE.MISSION },
      { type: 'arm' }
    ]
  }

  planPause(): ActionStep[] {
    // QGC PX4FirmwarePlugin::pauseVehicle: DO_REPOSITION with all NaN (no DO_PAUSE_CONTINUE).
    return [
      {
        type: 'command',
        command: 192, // MAV_CMD_DO_REPOSITION
        params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: NaN, p6: NaN, p7: NaN }
      }
    ]
  }

  planGoto({ lat, lon, alt }: GotoParams): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeGotoLocation: DO_REPOSITION with target coords.
    return [
      {
        type: 'command',
        command: 192,
        params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: lat, p6: lon, p7: alt }
      }
    ]
  }

  planChangeAltitude({ altMsl }: ChangeAltitudeParams): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeChangeAltitude → _changeAltAfterPause:
    // DO_REPOSITION with NaN for yaw/lat/lon (hold) and new AMSL altitude in p7.
    return [
      {
        type: 'command',
        command: 192,
        params: { p1: -1, p2: 1, p3: 0, p4: NaN, p5: NaN, p6: NaN, p7: altMsl }
      }
    ]
  }

  planChangeHeading({ headingDeg }: ChangeHeadingParams): ActionStep[] {
    // QGC PX4FirmwarePlugin::guidedModeChangeHeading: DO_REPOSITION with yaw in radians.
    // PX4 firmware specifically accepts radians here (spec says degrees, but QGC sends radians
    // and PX4 works with that — matching QGC to preserve parity).
    const rad = (headingDeg * Math.PI) / 180
    return [
      {
        type: 'command',
        command: 192,
        params: { p1: -1, p2: 1, p3: 0, p4: rad, p5: NaN, p6: NaN, p7: NaN }
      }
    ]
  }

  planChangeSpeed({ speedType, speed }: ChangeSpeedParams): ActionStep[] {
    return [
      {
        type: 'command',
        command: 178, // MAV_CMD_DO_CHANGE_SPEED
        params: { p1: speedType, p2: speed, p3: -1, p4: 0, p5: NaN, p6: NaN, p7: NaN }
      }
    ]
  }

  planOrbit({ lat, lon, altMsl, radius }: OrbitParams): ActionStep[] {
    // QGC Vehicle::guidedModeOrbit → MAV_CMD_DO_ORBIT.
    // Negative radius = CCW per MAVLink spec.
    // ORBIT_YAW_BEHAVIOUR_UNCHANGED = 1 (keep current yaw mode)
    return [
      {
        type: 'command',
        command: 34,
        params: { p1: radius, p2: NaN, p3: 1, p4: NaN, p5: lat, p6: lon, p7: altMsl }
      }
    ]
  }

  planLandingGear({ state }: LandingGearParams): ActionStep[] {
    // QGC Vehicle::landingGearDeploy/Retract: MAV_CMD_AIRFRAME_CONFIGURATION
    // p1 = -1 (all gears), p2 = 0 (down/deploy) or 1 (up/retract)
    return [
      {
        type: 'command',
        command: 2520,
        params: { p1: -1, p2: state }
      }
    ]
  }
}
