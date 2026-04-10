/** Sensor types that can be calibrated */
export enum CalibrationSensor {
  Gyro = 'gyro',
  Compass = 'compass',
  Accel = 'accel',
  AccelSimple = 'accelSimple',
  LevelHorizon = 'levelHorizon',
  Pressure = 'pressure',
  Airspeed = 'airspeed',
  CompassMot = 'compassMot',
  Esc = 'esc'
}

/** Status of an active calibration */
export enum CalibrationStatus {
  Idle = 'idle',
  Started = 'started',
  WaitingForOrientation = 'waitingForOrientation',
  Collecting = 'collecting',
  Complete = 'complete',
  Failed = 'failed',
  Cancelled = 'cancelled'
}

/** Vehicle orientations for 6-side accel calibration */
export enum CalibrationOrientation {
  Level = 'level',
  UpsideDown = 'upsideDown',
  NoseDown = 'noseDown',
  NoseUp = 'noseUp',
  LeftSide = 'leftSide',
  RightSide = 'rightSide'
}

/** Full calibration state pushed to renderer */
export interface CalibrationState {
  sensor: CalibrationSensor
  status: CalibrationStatus
  message: string
  messages: string[] // all STATUSTEXT messages received during calibration
  progress: number // 0..1
  currentOrientationProgress: number // 0..1 progress within the current orientation (PX4)
  orientationsCompleted: CalibrationOrientation[]
  currentOrientation: CalibrationOrientation | null
}

/** Compass calibration progress (per compass) */
export interface MagCalProgress {
  compassId: number
  completionPct: number
  directionX: number
  directionY: number
  directionZ: number
}

/** Compass calibration report (per compass) */
export interface MagCalReport {
  compassId: number
  calStatus: number
  fitness: number
  ofsX: number
  ofsY: number
  ofsZ: number
}

/** RC calibration step */
export enum RcCalStep {
  Idle = 'idle',
  Center = 'center',
  DetectSticks = 'detectSticks',
  MinMax = 'minMax',
  Complete = 'complete'
}

/** Per-channel RC calibration data */
export interface RcCalibrationChannelData {
  min: number
  max: number
  trim: number
  reversed: boolean
  currentValue: number
}

/** Full RC calibration state pushed to renderer */
export interface RcCalibrationState {
  step: RcCalStep
  channels: Record<number, RcCalibrationChannelData>
  channelCount: number
  /** Detected stick-to-channel mapping: Roll/Pitch/Yaw/Throttle -> channel index */
  stickMapping: Record<string, number | null>
  /** Which stick is currently being detected (during DetectSticks step) */
  currentStick?: string
}

/** Flight mode configuration */
export interface FlightModeConfig {
  modeChannel: number
  modes: Array<{
    slot: number
    modeNumber: number
    modeName: string
  }>
  activeSlot: number
}

/** Firmware upgrade status */
export enum FirmwareUpgradeStatus {
  Idle = 'idle',
  Selecting = 'selecting',
  Uploading = 'uploading',
  Rebooting = 'rebooting',
  Complete = 'complete',
  Failed = 'failed'
}

/** Firmware upgrade state pushed to renderer */
export interface FirmwareUpgradeState {
  status: FirmwareUpgradeStatus
  progress: number // 0..1
  message: string
  fileName?: string
  fileSize?: number
}

/** Board info derived from AUTOPILOT_VERSION */
export interface BoardInfo {
  boardVendorId: number
  boardProductId: number
  uid: string
}

/** Setup view page identifiers */
export type SetupPage =
  | 'summary'
  | 'general'
  | 'firmware'
  | 'sensors'
  | 'radio'
  | 'flightModes'
  | 'power'
  | 'safety'
  | 'airframe'
  | 'tuning'
  | 'actuators'
  | 'parameters'
  | 'video'
  | 'radar'
  | 'mavConsole'
  | 'mavInspector'
  | 'mavlinkForwarding'

/** ArduCopter flight mode names indexed by custom_mode number */
export const ARDUCOPTER_MODE_NAMES: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  7: 'Circle',
  9: 'Land',
  11: 'Drift',
  13: 'Sport',
  14: 'Flip',
  15: 'AutoTune',
  16: 'PosHold',
  17: 'Brake',
  18: 'Throw',
  19: 'Avoid',
  20: 'GuidedNoGPS',
  21: 'SmartRTL'
}

/** ArduPlane flight mode names indexed by custom_mode number */
export const ARDUPLANE_MODE_NAMES: Record<number, string> = {
  0: 'Manual',
  1: 'Circle',
  2: 'Stabilize',
  3: 'Training',
  4: 'Acro',
  5: 'FlyByWireA',
  6: 'FlyByWireB',
  7: 'Cruise',
  8: 'AutoTune',
  10: 'Auto',
  11: 'RTL',
  12: 'Loiter',
  13: 'Takeoff',
  14: 'Avoid',
  15: 'Guided',
  17: 'QStabilize',
  18: 'QHover',
  19: 'QLoiter',
  20: 'QLand',
  21: 'QRTL',
  22: 'QAutoTune',
  23: 'QAcro',
  24: 'Thermal'
}

/** ArduRover flight mode names indexed by custom_mode number */
export const ARDUROVER_MODE_NAMES: Record<number, string> = {
  0: 'Manual',
  1: 'Acro',
  3: 'Steering',
  4: 'Hold',
  5: 'Loiter',
  6: 'Follow',
  7: 'Simple',
  10: 'Auto',
  11: 'RTL',
  12: 'SmartRTL',
  15: 'Guided'
}

/** ArduSub flight mode names indexed by custom_mode number */
export const ARDUSUB_MODE_NAMES: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  7: 'Circle',
  9: 'Surface',
  16: 'PosHold',
  19: 'Manual'
}

/** Vehicle type enum for selecting mode name tables */
export enum VehicleType {
  Copter = 'copter',
  Plane = 'plane',
  Rover = 'rover',
  Sub = 'sub'
}

/** Map MAV_TYPE number to VehicleType. Defaults to Copter for unknown types. */
export function mavTypeToVehicleType(mavType: number): VehicleType {
  // MAV_TYPE values from mavlink-mappings minimal.MavType
  switch (mavType) {
    case 1: // FIXED_WING
      return VehicleType.Plane
    case 10: // GROUND_ROVER
    case 11: // SURFACE_BOAT
      return VehicleType.Rover
    case 12: // SUBMARINE
      return VehicleType.Sub
    default: // QUADROTOR(2), HEXAROTOR(13), OCTOROTOR(14), TRICOPTER(15), HELICOPTER(4), etc.
      return VehicleType.Copter
  }
}

/** Get mode names for a given vehicle type */
export function getModeNamesForVehicleType(type: VehicleType): Record<number, string> {
  switch (type) {
    case VehicleType.Copter:
      return ARDUCOPTER_MODE_NAMES
    case VehicleType.Plane:
      return ARDUPLANE_MODE_NAMES
    case VehicleType.Rover:
      return ARDUROVER_MODE_NAMES
    case VehicleType.Sub:
      return ARDUSUB_MODE_NAMES
  }
}
