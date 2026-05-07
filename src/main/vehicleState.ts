import { common, minimal } from 'mavlink-mappings'
import type {
  VehicleSnapshot,
  VehicleDelta,
  VehicleGroupName,
  CoreGroup,
  AttitudeGroup,
  GpsGroup,
  GpsRawGroup,
  HomeGroup,
  BatteryGroup,
  RcGroup,
  VfrHudGroup,
  SysStatusGroup,
  WindGroup,
  RadioGroup,
  VibrationGroup,
  ExtendedStateGroup,
  MissionStatusGroup,
  TerrainGroup,
  CameraGroup,
  ServoOutputGroup
} from '@shared/ipc/VehicleState'
import { DeltaGroup, type IDeltaGroup } from './state/DeltaGroup'
import { dialectForAutopilot } from '../core/vehicle/dialect'

export type { VehicleSnapshot, VehicleDelta, VehicleGroupName }

// ── Default group factories ─────────────────────────────────────
function defaultCore(): CoreGroup {
  return {
    sysid: 0,
    compid: 0,
    armed: false,
    flightMode: 0,
    flightModeName: '',
    vehicleType: 0,
    autopilot: 0,
    systemStatus: 0,
    firmwareVersionMajor: 0,
    firmwareVersionMinor: 0,
    firmwareVersionPatch: 0,
    communicationLost: false,
    communicationLostCountdown: 0,
    seq: 0
  }
}
function defaultAttitude(): AttitudeGroup {
  return { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 0 }
}
function defaultGps(): GpsGroup {
  return { lat: 0, lon: 0, alt: 0, relativeAlt: 0, vx: 0, vy: 0, vz: 0, hdg: 0, seq: 0 }
}
function defaultGpsRaw(): GpsRawGroup {
  return { fixType: 0, satelliteCount: 0, hdop: 99.99, vdop: 99.99, lat: 0, lon: 0, alt: 0, seq: 0 }
}
function defaultHome(): HomeGroup {
  return { lat: 0, lon: 0, alt: 0, valid: false, seq: 0 }
}
function defaultBattery(): BatteryGroup {
  return { batteries: [], seq: 0 }
}
function defaultRc(): RcGroup {
  return { channels: [], rssi: 0, channelCount: 0, seq: 0 }
}
function defaultVfrHud(): VfrHudGroup {
  return { airspeed: 0, groundspeed: 0, heading: 0, throttle: 0, altitude: 0, climbRate: 0, seq: 0 }
}
function defaultSysStatus(): SysStatusGroup {
  return {
    onboardControlSensorsPresent: 0,
    onboardControlSensorsEnabled: 0,
    onboardControlSensorsHealth: 0,
    load: 0,
    dropRateComm: 0,
    errorsComm: 0,
    seq: 0
  }
}
function defaultWind(): WindGroup {
  return { direction: 0, speed: 0, verticalSpeed: 0, seq: 0 }
}
function defaultRadio(): RadioGroup {
  return { rssi: 0, remrssi: 0, txbuf: 0, noise: 0, remnoise: 0, rxerrors: 0, fixed: 0, seq: 0 }
}
function defaultVibration(): VibrationGroup {
  return {
    xVibration: 0,
    yVibration: 0,
    zVibration: 0,
    clipping0: 0,
    clipping1: 0,
    clipping2: 0,
    seq: 0
  }
}
function defaultExtendedState(): ExtendedStateGroup {
  return { vtolState: 0, landedState: 0, seq: 0 }
}
function defaultMissionStatus(): MissionStatusGroup {
  return { currentIndex: 0, totalCount: 0, seq: 0 }
}
function defaultTerrain(): TerrainGroup {
  return { terrainAltitude: 0, terrainValid: false, distanceToGround: 0, seq: 0 }
}
function defaultServoOutput(): ServoOutputGroup {
  return { port: 0, outputs: [], seq: 0 }
}
function defaultCamera(): CameraGroup {
  return {
    discovered: false,
    mode: 0,
    isRecordingVideo: false,
    isCapturingImage: false,
    photoCount: 0,
    videoRecordingTimeMs: 0,
    availableCapacityMib: 0,
    hasCapVideo: false,
    hasCapImage: false,
    seq: 0
  }
}

export function defaultSnapshot(): VehicleSnapshot {
  return {
    core: defaultCore(),
    attitude: defaultAttitude(),
    gps: defaultGps(),
    gpsRaw: defaultGpsRaw(),
    home: defaultHome(),
    battery: defaultBattery(),
    rc: defaultRc(),
    vfrHud: defaultVfrHud(),
    sysStatus: defaultSysStatus(),
    wind: defaultWind(),
    radio: defaultRadio(),
    vibration: defaultVibration(),
    extendedState: defaultExtendedState(),
    missionStatus: defaultMissionStatus(),
    terrain: defaultTerrain(),
    camera: defaultCamera(),
    servoOutput: defaultServoOutput()
  }
}

// ── Message IDs ──────────────────────────────────────────────────
const MSG_HEARTBEAT = 0
const MSG_SYS_STATUS = 1
const MSG_GPS_RAW_INT = 24
const MSG_ATTITUDE = 30
const MSG_ATTITUDE_QUATERNION = 31
const MSG_GLOBAL_POSITION_INT = 33
const MSG_RC_CHANNELS_RAW = 35
const MSG_SERVO_OUTPUT_RAW = 36
const MSG_RC_CHANNELS = 65
const MSG_VFR_HUD = 74
const MSG_COMMAND_ACK = 77
const MSG_BATTERY_STATUS = 147
const MSG_HOME_POSITION = 242
const MSG_EXTENDED_SYS_STATE = 245
const MSG_VIBRATION = 241
const MSG_RADIO_STATUS = 109
const MSG_WIND = 168 // ArduPilot-specific
const MSG_TERRAIN_REPORT = 136
const MSG_LOCAL_POSITION_NED = 32
const MSG_MISSION_CURRENT = 42
const MSG_CAMERA_INFORMATION = 259
const MSG_CAMERA_SETTINGS = 260
const MSG_CAMERA_CAPTURE_STATUS = 262

export class VehicleState {
  private core = new DeltaGroup<CoreGroup>(defaultCore())
  private attitude = new DeltaGroup<AttitudeGroup>(defaultAttitude())
  private gps = new DeltaGroup<GpsGroup>(defaultGps())
  private gpsRaw = new DeltaGroup<GpsRawGroup>(defaultGpsRaw())
  private home = new DeltaGroup<HomeGroup>(defaultHome())
  private battery = new DeltaGroup<BatteryGroup>(defaultBattery(), (b) => ({
    ...b,
    batteries: [...b.batteries]
  }))
  private rc = new DeltaGroup<RcGroup>(defaultRc(), (r) => ({ ...r, channels: [...r.channels] }))
  private vfrHud = new DeltaGroup<VfrHudGroup>(defaultVfrHud())
  private sysStatus = new DeltaGroup<SysStatusGroup>(defaultSysStatus())
  private wind = new DeltaGroup<WindGroup>(defaultWind())
  private radio = new DeltaGroup<RadioGroup>(defaultRadio())
  private vibration = new DeltaGroup<VibrationGroup>(defaultVibration())
  private extendedState = new DeltaGroup<ExtendedStateGroup>(defaultExtendedState())
  private missionStatus = new DeltaGroup<MissionStatusGroup>(defaultMissionStatus())
  private terrain = new DeltaGroup<TerrainGroup>(defaultTerrain())
  private camera = new DeltaGroup<CameraGroup>(defaultCamera())
  private servoOutput = new DeltaGroup<ServoOutputGroup>(defaultServoOutput(), (s) => ({
    ...s,
    outputs: [...s.outputs]
  }))

  private readonly groups: Record<VehicleGroupName, IDeltaGroup>

  constructor() {
    this.groups = {
      core: this.core,
      attitude: this.attitude,
      gps: this.gps,
      gpsRaw: this.gpsRaw,
      home: this.home,
      battery: this.battery,
      rc: this.rc,
      vfrHud: this.vfrHud,
      sysStatus: this.sysStatus,
      wind: this.wind,
      radio: this.radio,
      vibration: this.vibration,
      extendedState: this.extendedState,
      missionStatus: this.missionStatus,
      terrain: this.terrain,
      camera: this.camera,
      servoOutput: this.servoOutput
    }
  }

  handleMessage(msgid: number, data: unknown): void {
    switch (msgid) {
      case MSG_HEARTBEAT:
        this._handleHeartbeat(data as minimal.Heartbeat)
        break
      case MSG_SYS_STATUS:
        this._handleSysStatus(data as common.SysStatus)
        break
      case MSG_GPS_RAW_INT:
        this._handleGpsRawInt(data as common.GpsRawInt)
        break
      case MSG_ATTITUDE:
        this._handleAttitude(data as common.Attitude)
        break
      case MSG_ATTITUDE_QUATERNION:
        this._handleAttitudeQuaternion(data as common.AttitudeQuaternion)
        break
      case MSG_GLOBAL_POSITION_INT:
        this._handleGlobalPositionInt(data as common.GlobalPositionInt)
        break
      case MSG_RC_CHANNELS_RAW:
        this._handleRcChannelsRaw(data as common.RcChannelsRaw)
        break
      case MSG_SERVO_OUTPUT_RAW:
        this._handleServoOutputRaw(data as common.ServoOutputRaw)
        break
      case MSG_RC_CHANNELS:
        this._handleRcChannels(data as common.RcChannels)
        break
      case MSG_VFR_HUD:
        this._handleVfrHud(data as common.VfrHud)
        break
      case MSG_BATTERY_STATUS:
        this._handleBatteryStatus(data as common.BatteryStatus)
        break
      case MSG_HOME_POSITION:
        this._handleHomePosition(data as common.HomePosition)
        break
      case MSG_EXTENDED_SYS_STATE:
        this._handleExtendedSysState(data as common.ExtendedSysState)
        break
      case MSG_VIBRATION:
        this._handleVibration(data as common.Vibration)
        break
      case MSG_RADIO_STATUS:
        this._handleRadioStatus(data as common.RadioStatus)
        break
      case MSG_WIND:
        this._handleWind(data as Record<string, number>)
        break
      case MSG_TERRAIN_REPORT:
        this._handleTerrainReport(data as common.TerrainReport)
        break
      case MSG_LOCAL_POSITION_NED:
        this._handleLocalPositionNed(data as common.LocalPositionNed)
        break
      case MSG_MISSION_CURRENT:
        this._handleMissionCurrent(data as common.MissionCurrent)
        break
      case MSG_CAMERA_INFORMATION:
        this._handleCameraInformation(data as Record<string, unknown>)
        break
      case MSG_CAMERA_SETTINGS:
        this._handleCameraSettings(data as Record<string, number>)
        break
      case MSG_CAMERA_CAPTURE_STATUS:
        this._handleCameraCaptureStatus(data as Record<string, number>)
        break
      case MSG_COMMAND_ACK:
        // Handled by MavCommandQueue in Phase 3
        break
    }
  }

  private _handleHeartbeat(hb: minimal.Heartbeat): void {
    const dialect = dialectForAutopilot(hb.autopilot)
    this.core.update({
      armed: !!(hb.baseMode & minimal.MavModeFlag.SAFETY_ARMED),
      flightMode: hb.customMode,
      flightModeName: dialect.customModeToName(hb.customMode),
      vehicleType: hb.type,
      autopilot: hb.autopilot,
      systemStatus: hb.systemStatus
    })
  }

  private _handleSysStatus(ss: common.SysStatus): void {
    this.sysStatus.update({
      onboardControlSensorsPresent: ss.onboardControlSensorsPresent,
      onboardControlSensorsEnabled: ss.onboardControlSensorsEnabled,
      onboardControlSensorsHealth: ss.onboardControlSensorsHealth,
      load: ss.load,
      dropRateComm: ss.dropRateComm,
      errorsComm: ss.errorsComm
    })
  }

  private _handleGpsRawInt(gps: common.GpsRawInt): void {
    this.gpsRaw.update({
      fixType: gps.fixType,
      satelliteCount: gps.satellitesVisible,
      hdop: gps.eph / 100,
      vdop: gps.epv / 100,
      lat: gps.lat / 1e7,
      lon: gps.lon / 1e7,
      alt: gps.alt / 1000
    })
  }

  /** Track whether we receive ATTITUDE_QUATERNION — if so, prefer it over ATTITUDE (like QGC). */
  private _receivingAttitudeQuaternion = false

  private _handleAttitude(att: common.Attitude): void {
    // If we're receiving ATTITUDE_QUATERNION, ignore ATTITUDE (QGC does the same)
    if (this._receivingAttitudeQuaternion) return
    this.attitude.update({
      roll: att.roll,
      pitch: att.pitch,
      yaw: att.yaw,
      rollSpeed: att.rollspeed,
      pitchSpeed: att.pitchspeed,
      yawSpeed: att.yawspeed
    })
  }

  private _handleAttitudeQuaternion(att: common.AttitudeQuaternion): void {
    this._receivingAttitudeQuaternion = true
    // Convert quaternion to Euler angles (matches QGC mavlink_quaternion_to_euler)
    const q1 = att.q1,
      q2 = att.q2,
      q3 = att.q3,
      q4 = att.q4
    const roll = Math.atan2(2 * (q1 * q2 + q3 * q4), 1 - 2 * (q2 * q2 + q3 * q3))
    const sinp = 2 * (q1 * q3 - q4 * q2)
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp)
    const yaw = Math.atan2(2 * (q1 * q4 + q2 * q3), 1 - 2 * (q3 * q3 + q4 * q4))

    this.attitude.update({
      roll,
      pitch,
      yaw,
      rollSpeed: att.rollspeed,
      pitchSpeed: att.pitchspeed,
      yawSpeed: att.yawspeed
    })
  }

  private _hasGlobalPosition = false

  private _handleGlobalPositionInt(pos: common.GlobalPositionInt): void {
    this._hasGlobalPosition = true
    // Derive heading from ATTITUDE.yaw (EKF output, high-rate, smooth) like QGC,
    // rather than GLOBAL_POSITION_INT.hdg which can jitter at lower update rates.
    let hdg = this.gps.snapshot().hdg
    if (this.attitude.seq > 0) {
      hdg = (this.attitude.snapshot().yaw * 180) / Math.PI
      if (hdg < 0) hdg += 360
    } else if (pos.hdg !== 65535) {
      hdg = pos.hdg / 100
    }

    this.gps.update({
      lat: pos.lat / 1e7,
      lon: pos.lon / 1e7,
      alt: pos.alt / 1000,
      relativeAlt: pos.relativeAlt / 1000,
      vx: pos.vx / 100,
      vy: pos.vy / 100,
      vz: pos.vz / 100,
      hdg
    })
  }

  /**
   * Handle LOCAL_POSITION_NED — used by PX4 SIH (no GPS mode).
   * Converts NED offsets from home to approximate lat/lon using the home position.
   * Only updates gps if GLOBAL_POSITION_INT hasn't provided data yet.
   */
  private _handleLocalPositionNed(pos: common.LocalPositionNed): void {
    // Only use local position as fallback when GLOBAL_POSITION_INT isn't available
    if (this._hasGlobalPosition) return

    const home = this.home.snapshot()
    if (home.lat === 0 && home.lon === 0) return // no home position yet

    // Convert NED meters to lat/lon degrees
    // 1 degree lat ≈ 111,320m, 1 degree lon ≈ 111,320m * cos(lat)
    const lat = home.lat + pos.x / 111320
    const lon = home.lon + pos.y / (111320 * Math.cos((home.lat * Math.PI) / 180))
    const alt = home.alt - pos.z // NED: z is down

    // Derive heading from ATTITUDE.yaw (vehicle nose) like QGC, not from
    // velocity atan2(vy,vx) which is course-over-ground and jitters during turns.
    let hdg = this.gps.snapshot().hdg
    if (this.attitude.seq > 0) {
      hdg = (this.attitude.snapshot().yaw * 180) / Math.PI
      if (hdg < 0) hdg += 360
    } else {
      // Fallback to velocity-derived heading when no attitude data yet
      hdg = (Math.atan2(pos.vy, pos.vx) * 180) / Math.PI
      if (hdg < 0) hdg += 360
    }

    this.gps.update({
      lat,
      lon,
      alt,
      relativeAlt: -pos.z,
      vx: pos.vx,
      vy: pos.vy,
      vz: pos.vz,
      hdg
    })
  }

  private _handleRcChannelsRaw(rc: common.RcChannelsRaw): void {
    const channels = [
      rc.chan1Raw,
      rc.chan2Raw,
      rc.chan3Raw,
      rc.chan4Raw,
      rc.chan5Raw,
      rc.chan6Raw,
      rc.chan7Raw,
      rc.chan8Raw
    ]
    this.rc.update({ channels, rssi: rc.rssi, channelCount: 8 })
  }

  private _handleRcChannels(rc: common.RcChannels): void {
    const channels: number[] = []
    for (let i = 1; i <= rc.chancount; i++) {
      const key = `chan${i}Raw` as keyof typeof rc
      const val = rc[key]
      if (typeof val === 'number') channels.push(val)
    }
    this.rc.update({ channels, rssi: rc.rssi, channelCount: rc.chancount })
  }

  private _handleServoOutputRaw(srv: common.ServoOutputRaw): void {
    const outputs: number[] = []
    for (let i = 1; i <= 16; i++) {
      const key = `servo${i}Raw` as keyof typeof srv
      const val = srv[key]
      if (typeof val === 'number') outputs.push(val)
    }
    this.servoOutput.update({ port: srv.port, outputs })
  }

  private _handleVfrHud(hud: common.VfrHud): void {
    this.vfrHud.update({
      airspeed: hud.airspeed,
      groundspeed: hud.groundspeed,
      heading: hud.heading,
      throttle: hud.throttle,
      altitude: hud.alt,
      climbRate: hud.climb
    })
  }

  private _handleBatteryStatus(bat: common.BatteryStatus): void {
    const existing = this.battery.snapshot().batteries
    const idx = existing.findIndex((b) => b.id === bat.id)

    // Sum all valid cell voltages (matching QGC behaviour):
    // voltages[0..9]: skip UINT16_MAX (65535 = not provided)
    // voltagesExt[0..3]: skip 0 (not provided)
    let voltage = 0
    let cellCount = 0
    for (let i = 0; i < 10; i++) {
      const v = bat.voltages[i]
      if (v === undefined || v === 65535) break
      voltage += v / 1000
      cellCount++
    }
    if (bat.voltagesExt) {
      for (let i = 0; i < 4; i++) {
        const v = bat.voltagesExt[i]
        if (v === undefined || v === 0) break
        voltage += v / 1000
        cellCount++
      }
    }

    const instance = {
      id: bat.id,
      voltage,
      current: bat.currentBattery === -1 ? 0 : bat.currentBattery / 100,
      remaining: bat.batteryRemaining === -1 ? -1 : bat.batteryRemaining,
      temperature: bat.temperature / 100,
      cellCount,
      chargeState: 0
    }
    const batteries = [...existing]
    if (idx >= 0) {
      batteries[idx] = instance
    } else {
      batteries.push(instance)
    }
    this.battery.update({ batteries })
  }

  private _handleHomePosition(hp: common.HomePosition): void {
    this.home.update({
      lat: hp.latitude / 1e7,
      lon: hp.longitude / 1e7,
      alt: hp.altitude / 1000,
      valid: true
    })
  }

  private _handleExtendedSysState(ess: common.ExtendedSysState): void {
    this.extendedState.update({ vtolState: ess.vtolState, landedState: ess.landedState })
  }

  private _handleVibration(vib: common.Vibration): void {
    this.vibration.update({
      xVibration: vib.vibrationX,
      yVibration: vib.vibrationY,
      zVibration: vib.vibrationZ,
      clipping0: vib.clipping0,
      clipping1: vib.clipping1,
      clipping2: vib.clipping2
    })
  }

  private _handleRadioStatus(rs: common.RadioStatus): void {
    this.radio.update({
      rssi: rs.rssi,
      remrssi: rs.remrssi,
      txbuf: rs.txbuf,
      noise: rs.noise,
      remnoise: rs.remnoise,
      rxerrors: rs.rxerrors,
      fixed: rs.fixed
    })
  }

  private _handleWind(w: Record<string, number>): void {
    this.wind.update({
      direction: w['direction'] ?? 0,
      speed: w['speed'] ?? 0,
      verticalSpeed: w['speed_z'] ?? 0
    })
  }

  private _handleTerrainReport(tr: common.TerrainReport): void {
    this.terrain.update({
      terrainAltitude: tr.terrainHeight,
      terrainValid: tr.terrainHeight !== 0,
      distanceToGround: tr.currentHeight
    })
  }

  private _handleMissionCurrent(mc: common.MissionCurrent): void {
    this.missionStatus.update({ currentIndex: mc.seq })
  }

  private _handleCameraInformation(ci: Record<string, unknown>): void {
    const flags = (ci['flags'] as number) ?? 0
    this.camera.update({
      discovered: true,
      hasCapVideo: !!(flags & 1), // CAMERA_CAP_FLAGS_CAPTURE_VIDEO
      hasCapImage: !!(flags & 2) // CAMERA_CAP_FLAGS_CAPTURE_IMAGE
    })
  }

  private _handleCameraSettings(cs: Record<string, number>): void {
    this.camera.update({ mode: cs['modeId'] ?? 0 })
  }

  private _handleCameraCaptureStatus(cs: Record<string, number>): void {
    this.camera.update({
      isCapturingImage: cs['imageStatus'] === 1 || cs['imageStatus'] === 3,
      isRecordingVideo: cs['videoStatus'] === 1,
      photoCount: cs['imageCount'] ?? this.camera.snapshot().photoCount,
      videoRecordingTimeMs: cs['recordingTimeMs'] ?? 0,
      availableCapacityMib: cs['availableCapacity'] ?? 0
    })
  }

  setFirmwareVersion(major: number, minor: number, patch: number): void {
    this.core.updateIfChanged({
      firmwareVersionMajor: major,
      firmwareVersionMinor: minor,
      firmwareVersionPatch: patch
    })
  }

  setSysId(sysid: number): void {
    this.core.updateIfChanged({ sysid })
  }

  setCompId(compid: number): void {
    this.core.updateIfChanged({ compid })
  }

  setCommunicationLost(lost: boolean): void {
    this.core.updateIfChanged({ communicationLost: lost })
  }

  setFlightModeName(name: string): void {
    this.core.updateIfChanged({ flightModeName: name })
  }

  /** Fast O(1) check: are any groups dirty? */
  hasDirty(): boolean {
    for (const key in this.groups) {
      if (this.groups[key as VehicleGroupName].dirty) return true
    }
    return false
  }

  /** Returns only changed groups and resets dirty flags. */
  getDelta(): VehicleDelta {
    const delta: VehicleDelta = {}
    for (const key in this.groups) {
      const name = key as VehicleGroupName
      const group = this.groups[name]
      const snap = group.takeDelta()
      if (snap !== null) {
        ;(delta as Record<string, unknown>)[name] = snap
      }
    }
    return delta
  }

  getSnapshot(): VehicleSnapshot {
    return {
      core: this.core.snapshot(),
      attitude: this.attitude.snapshot(),
      gps: this.gps.snapshot(),
      gpsRaw: this.gpsRaw.snapshot(),
      home: this.home.snapshot(),
      battery: this.battery.snapshot(),
      rc: this.rc.snapshot(),
      vfrHud: this.vfrHud.snapshot(),
      sysStatus: this.sysStatus.snapshot(),
      wind: this.wind.snapshot(),
      radio: this.radio.snapshot(),
      vibration: this.vibration.snapshot(),
      extendedState: this.extendedState.snapshot(),
      missionStatus: this.missionStatus.snapshot(),
      terrain: this.terrain.snapshot(),
      camera: this.camera.snapshot(),
      servoOutput: this.servoOutput.snapshot()
    }
  }

  getGroup<K extends VehicleGroupName>(key: K): VehicleSnapshot[K] {
    return this.groups[key].snapshot() as VehicleSnapshot[K]
  }
}
