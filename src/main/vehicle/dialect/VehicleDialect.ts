/**
 * VehicleDialect — autopilot-specific command/mode semantics.
 *
 * Each autopilot family (PX4, ArduPilot, ...) implements this interface with
 * its own wire-level command encodings and mode-name tables. Vehicle.ts picks a
 * dialect based on the HEARTBEAT's autopilot field and routes guided actions
 * through it. Adding a new autopilot means adding one new implementation; the
 * call sites never grow `if (autopilot === ...)` branches.
 */

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
  /** base_mode for SET_MODE message (typically MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) */
  baseMode: number
  /** custom_mode for SET_MODE message */
  customMode: number
}

export interface ArmStep {
  type: 'arm'
}

export type ActionStep = CommandStep | ModeStep | ArmStep

// ── Planner input parameter types ─────────────────────────────────

export interface TakeoffParams {
  /** Relative altitude target (m above takeoff) */
  altitude: number
  /** Current MSL altitude (m) — PX4 needs AMSL, ArduPilot ignores */
  currentAltMsl: number
}

export interface GotoParams {
  lat: number
  lon: number
  /** AMSL altitude (m) */
  alt: number
}

export interface ChangeAltitudeParams {
  /** Current latitude (degrees) — PX4 ignores (NaN hold), ArduPilot Copter requires real value */
  lat: number
  lon: number
  /** New target altitude AMSL (m) */
  altMsl: number
}

export interface ChangeHeadingParams {
  /** Target heading in degrees (0-360, 0 = north, CW positive) */
  headingDeg: number
  /** ArduPilot CONDITION_YAW yaw rate limit (deg/s, from ATC_RATE_Y_MAX). 0 = autopilot default */
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
  altMsl: number
  /** Radius (m). Negative = counter-clockwise (MAVLink spec convention) */
  radius: number
}

export interface LandingGearParams {
  /** 0 = deploy/down, 1 = retract/up */
  state: number
}

// ── Common constants ──────────────────────────────────────────────

// MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (bit 0)
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1

// ── Dialect interface ─────────────────────────────────────────────

export type AutopilotName = 'px4' | 'ardupilot'

export interface VehicleDialect {
  readonly name: AutopilotName

  /**
   * True when flight-mode changes must use the SET_MODE message (msg id 11)
   * rather than the DO_SET_MODE command. PX4 requires SET_MODE.
   */
  readonly usesSetModeMessage: boolean

  /** Resolve a display mode name (e.g. "Loiter") to the autopilot's custom_mode number. Returns null if unknown. */
  modeNameToCustomMode(name: string): number | null

  /** Map a HEARTBEAT custom_mode value back to the display mode name. */
  customModeToName(customMode: number): string

  // Guided / action planners
  planArm(): ActionStep[]
  planDisarm(): ActionStep[]
  planForceArm(): ActionStep[]
  planEmergencyStop(): ActionStep[]
  planTakeoff(p: TakeoffParams): ActionStep[]
  planRtl(): ActionStep[]
  planLand(): ActionStep[]
  planMissionStart(): ActionStep[]
  planPause(): ActionStep[]
  planGoto(p: GotoParams): ActionStep[]
  planChangeAltitude(p: ChangeAltitudeParams): ActionStep[]
  planChangeHeading(p: ChangeHeadingParams): ActionStep[]
  planChangeSpeed(p: ChangeSpeedParams): ActionStep[]
  planOrbit(p: OrbitParams): ActionStep[]
  planLandingGear(p: LandingGearParams): ActionStep[]
}
