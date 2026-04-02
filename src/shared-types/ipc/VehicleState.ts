/**
 * Complete vehicle state snapshot, partitioned into groups.
 * Each group has a `seq` counter that increments on every update.
 * The IPC bridge sends only groups where `seq` has changed since last send.
 */

// ── Core ──────────────────────────────────────────────────────────
export interface CoreGroup {
  sysid: number
  compid: number
  armed: boolean
  flightMode: number
  flightModeName: string
  vehicleType: number // MAV_TYPE
  autopilot: number // MAV_AUTOPILOT
  systemStatus: number // MAV_STATE
  firmwareVersionMajor: number
  firmwareVersionMinor: number
  firmwareVersionPatch: number
  communicationLost: boolean
  communicationLostCountdown: number // seconds until comm lost
  seq: number
}

// ── Attitude ──────────────────────────────────────────────────────
export interface AttitudeGroup {
  roll: number // radians
  pitch: number // radians
  yaw: number // radians
  rollSpeed: number // rad/s
  pitchSpeed: number // rad/s
  yawSpeed: number // rad/s
  seq: number
}

// ── GPS / Position ────────────────────────────────────────────────
export interface GpsGroup {
  lat: number // degrees
  lon: number // degrees
  alt: number // MSL meters
  relativeAlt: number // AGL meters
  vx: number // m/s
  vy: number // m/s
  vz: number // m/s (positive = down)
  hdg: number // degrees 0..360
  seq: number
}

export interface GpsRawGroup {
  fixType: number // GPS_FIX_TYPE enum
  satelliteCount: number
  hdop: number
  vdop: number
  lat: number
  lon: number
  alt: number
  seq: number
}

// ── Home position ─────────────────────────────────────────────────
export interface HomeGroup {
  lat: number
  lon: number
  alt: number
  valid: boolean
  seq: number
}

// ── Battery ───────────────────────────────────────────────────────
export interface BatteryInstance {
  id: number
  voltage: number // V
  current: number // A
  remaining: number // 0-100%
  temperature: number // °C (-1 = unknown)
  cellCount: number
  chargeState: number // MAV_BATTERY_CHARGE_STATE
}

export interface BatteryGroup {
  batteries: BatteryInstance[]
  seq: number
}

// ── RC Channels ───────────────────────────────────────────────────
export interface RcGroup {
  channels: number[] // 1000-2000 PWM values
  rssi: number // 0-255
  channelCount: number
  seq: number
}

// ── VFR HUD ───────────────────────────────────────────────────────
export interface VfrHudGroup {
  airspeed: number // m/s
  groundspeed: number // m/s
  heading: number // degrees
  throttle: number // 0-100%
  altitude: number // MSL meters
  climbRate: number // m/s
  seq: number
}

// ── System status ─────────────────────────────────────────────────
export interface SysStatusGroup {
  onboardControlSensorsPresent: number
  onboardControlSensorsEnabled: number
  onboardControlSensorsHealth: number
  load: number // 0-1000 (CPU ‰)
  dropRateComm: number // 0-10000 (‰)
  errorsComm: number
  seq: number
}

// ── Wind ──────────────────────────────────────────────────────────
export interface WindGroup {
  direction: number // degrees (where wind is coming from)
  speed: number // m/s
  verticalSpeed: number // m/s
  seq: number
}

// ── Radio status ──────────────────────────────────────────────────
export interface RadioGroup {
  rssi: number
  remrssi: number
  txbuf: number
  noise: number
  remnoise: number
  rxerrors: number
  fixed: number
  seq: number
}

// ── Vibration ─────────────────────────────────────────────────────
export interface VibrationGroup {
  xVibration: number
  yVibration: number
  zVibration: number
  clipping0: number
  clipping1: number
  clipping2: number
  seq: number
}

// ── Extended system state ─────────────────────────────────────────
export interface ExtendedStateGroup {
  vtolState: number // MAV_VTOL_STATE
  landedState: number // MAV_LANDED_STATE
  seq: number
}

// ── Mission current ───────────────────────────────────────────────
export interface MissionStatusGroup {
  currentIndex: number
  totalCount: number
  seq: number
}

// ── Terrain ───────────────────────────────────────────────────────
export interface TerrainGroup {
  terrainAltitude: number // meters
  terrainValid: boolean
  distanceToGround: number // meters (vehicle alt - terrain alt)
  seq: number
}

// ── Camera ───────────────────────────────────────────────────────
export interface CameraGroup {
  discovered: boolean
  mode: number // CameraMode enum
  isRecordingVideo: boolean
  isCapturingImage: boolean
  photoCount: number
  videoRecordingTimeMs: number
  availableCapacityMib: number
  hasCapVideo: boolean
  hasCapImage: boolean
  seq: number
}

// ── Servo outputs ────────────────────────────────────────────────
export interface ServoOutputGroup {
  port: number // 0=MAIN, 1=AUX
  outputs: number[] // PWM values (up to 16 channels)
  seq: number
}

// ── Full snapshot ─────────────────────────────────────────────────
export interface VehicleSnapshot {
  core: CoreGroup
  attitude: AttitudeGroup
  gps: GpsGroup
  gpsRaw: GpsRawGroup
  home: HomeGroup
  battery: BatteryGroup
  rc: RcGroup
  vfrHud: VfrHudGroup
  sysStatus: SysStatusGroup
  wind: WindGroup
  radio: RadioGroup
  vibration: VibrationGroup
  extendedState: ExtendedStateGroup
  missionStatus: MissionStatusGroup
  terrain: TerrainGroup
  camera: CameraGroup
  servoOutput: ServoOutputGroup
}

/** Names of all vehicle state groups — used for delta tracking */
export type VehicleGroupName = keyof VehicleSnapshot

/** A partial snapshot containing only changed groups */
export type VehicleDelta = Partial<VehicleSnapshot>

/** Payload sent over IPC: delta + timestamp for latency measurement */
export interface VehicleDeltaPayload {
  vehicleId: number
  delta: VehicleDelta
  sentAt: number
}

/** Minimal vehicle position for multi-vehicle map display */
export interface VehiclePosition {
  id: number
  lat: number
  lon: number
  hdg: number
}
