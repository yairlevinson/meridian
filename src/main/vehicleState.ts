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

export type { VehicleSnapshot, VehicleDelta, VehicleGroupName }

// ArduCopter custom mode → display name
const COPTER_MODE_NAMES: Record<number, string> = {
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

// PX4 main mode is bits 16-23, sub-mode is bits 24-31
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

function px4ModeName(customMode: number): string {
  const mainMode = (customMode >> 16) & 0xff
  const subMode = (customMode >> 24) & 0xff
  const sub = PX4_MODE_NAMES[mainMode]
  if (sub) {
    return sub[subMode] ?? sub[0] ?? `PX4:${mainMode}.${subMode}`
  }
  return `Unknown (${customMode})`
}

function copterModeName(customMode: number): string {
  // ArduPilot modes fit in a small range (0-21)
  if (customMode <= 21) {
    return COPTER_MODE_NAMES[customMode] ?? `Unknown (${customMode})`
  }
  // Large values are likely PX4 custom_mode bitfield
  return px4ModeName(customMode)
}

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
  private state: VehicleSnapshot = defaultSnapshot()
  private dirty: Record<VehicleGroupName, boolean> = {
    core: false,
    attitude: false,
    gps: false,
    gpsRaw: false,
    home: false,
    battery: false,
    rc: false,
    vfrHud: false,
    sysStatus: false,
    wind: false,
    radio: false,
    vibration: false,
    extendedState: false,
    missionStatus: false,
    terrain: false,
    camera: false,
    servoOutput: false
  }
  private dirtyCount = 0

  private markDirty(group: VehicleGroupName): void {
    if (!this.dirty[group]) {
      this.dirty[group] = true
      this.dirtyCount++
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
    this.state.core = {
      ...this.state.core,
      armed: !!(hb.baseMode & minimal.MavModeFlag.SAFETY_ARMED),
      flightMode: hb.customMode,
      flightModeName: copterModeName(hb.customMode),
      vehicleType: hb.type,
      autopilot: hb.autopilot,
      systemStatus: hb.systemStatus,
      seq: this.state.core.seq + 1
    }
    this.markDirty('core')
  }

  private _handleSysStatus(ss: common.SysStatus): void {
    this.state.sysStatus = {
      onboardControlSensorsPresent: ss.onboardControlSensorsPresent,
      onboardControlSensorsEnabled: ss.onboardControlSensorsEnabled,
      onboardControlSensorsHealth: ss.onboardControlSensorsHealth,
      load: ss.load,
      dropRateComm: ss.dropRateComm,
      errorsComm: ss.errorsComm,
      seq: this.state.sysStatus.seq + 1
    }
    this.markDirty('sysStatus')
  }

  private _handleGpsRawInt(gps: common.GpsRawInt): void {
    this.state.gpsRaw = {
      fixType: gps.fixType,
      satelliteCount: gps.satellitesVisible,
      hdop: gps.eph / 100,
      vdop: gps.epv / 100,
      lat: gps.lat / 1e7,
      lon: gps.lon / 1e7,
      alt: gps.alt / 1000,
      seq: this.state.gpsRaw.seq + 1
    }
    this.markDirty('gpsRaw')
  }

  private _handleAttitude(att: common.Attitude): void {
    this.state.attitude = {
      roll: att.roll,
      pitch: att.pitch,
      yaw: att.yaw,
      rollSpeed: att.rollspeed,
      pitchSpeed: att.pitchspeed,
      yawSpeed: att.yawspeed,
      seq: this.state.attitude.seq + 1
    }
    this.markDirty('attitude')
  }

  private _handleGlobalPositionInt(pos: common.GlobalPositionInt): void {
    this.state.gps = {
      lat: pos.lat / 1e7,
      lon: pos.lon / 1e7,
      alt: pos.alt / 1000,
      relativeAlt: pos.relativeAlt / 1000,
      vx: pos.vx / 100,
      vy: pos.vy / 100,
      vz: pos.vz / 100,
      hdg: pos.hdg / 100,
      seq: this.state.gps.seq + 1
    }
    this.markDirty('gps')
  }

  /**
   * Handle LOCAL_POSITION_NED — used by PX4 SIH (no GPS mode).
   * Converts NED offsets from home to approximate lat/lon using the home position.
   * Only updates gps if GLOBAL_POSITION_INT hasn't provided data yet.
   */
  private _handleLocalPositionNed(pos: common.LocalPositionNed): void {
    // Only use local position as fallback when no global position is available
    if (this.state.gps.seq > 0 && this.state.gps.lat !== 0) return

    const homeLat = this.state.home.lat
    const homeLon = this.state.home.lon
    const homeAlt = this.state.home.alt
    if (homeLat === 0 && homeLon === 0) return // no home position yet

    // Convert NED meters to lat/lon degrees
    // 1 degree lat ≈ 111,320m, 1 degree lon ≈ 111,320m * cos(lat)
    const lat = homeLat + pos.x / 111320
    const lon = homeLon + pos.y / (111320 * Math.cos((homeLat * Math.PI) / 180))
    const alt = homeAlt - pos.z // NED: z is down

    const hdg = (Math.atan2(pos.vy, pos.vx) * 180) / Math.PI
    this.state.gps = {
      lat,
      lon,
      alt,
      relativeAlt: -pos.z,
      vx: pos.vx,
      vy: pos.vy,
      vz: pos.vz,
      hdg: hdg < 0 ? hdg + 360 : hdg,
      seq: this.state.gps.seq + 1
    }
    this.markDirty('gps')
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
    this.state.rc = {
      channels,
      rssi: rc.rssi,
      channelCount: 8,
      seq: this.state.rc.seq + 1
    }
    this.markDirty('rc')
  }

  private _handleRcChannels(rc: common.RcChannels): void {
    const channels: number[] = []
    for (let i = 1; i <= rc.chancount; i++) {
      const key = `chan${i}Raw` as keyof typeof rc
      const val = rc[key]
      if (typeof val === 'number') channels.push(val)
    }
    this.state.rc = {
      channels,
      rssi: rc.rssi,
      channelCount: rc.chancount,
      seq: this.state.rc.seq + 1
    }
    this.markDirty('rc')
  }

  private _handleServoOutputRaw(srv: common.ServoOutputRaw): void {
    const outputs: number[] = []
    for (let i = 1; i <= 16; i++) {
      const key = `servo${i}Raw` as keyof typeof srv
      const val = srv[key]
      if (typeof val === 'number') outputs.push(val)
    }
    this.state.servoOutput = {
      port: srv.port,
      outputs,
      seq: this.state.servoOutput.seq + 1
    }
    this.markDirty('servoOutput')
  }

  private _handleVfrHud(hud: common.VfrHud): void {
    this.state.vfrHud = {
      airspeed: hud.airspeed,
      groundspeed: hud.groundspeed,
      heading: hud.heading,
      throttle: hud.throttle,
      altitude: hud.alt,
      climbRate: hud.climb,
      seq: this.state.vfrHud.seq + 1
    }
    this.markDirty('vfrHud')
  }

  private _handleBatteryStatus(bat: common.BatteryStatus): void {
    const existing = this.state.battery.batteries
    const idx = existing.findIndex((b) => b.id === bat.id)
    const voltage = bat.voltages[0] !== undefined ? bat.voltages[0] / 1000 : 0
    const instance = {
      id: bat.id,
      voltage,
      current: bat.currentBattery / 100,
      remaining: bat.batteryRemaining,
      temperature: bat.temperature / 100,
      cellCount: bat.voltages.filter((v) => v !== undefined && v < 65535).length,
      chargeState: 0
    }
    const batteries = [...existing]
    if (idx >= 0) {
      batteries[idx] = instance
    } else {
      batteries.push(instance)
    }
    this.state.battery = { batteries, seq: this.state.battery.seq + 1 }
    this.markDirty('battery')
  }

  private _handleHomePosition(hp: common.HomePosition): void {
    this.state.home = {
      lat: hp.latitude / 1e7,
      lon: hp.longitude / 1e7,
      alt: hp.altitude / 1000,
      valid: true,
      seq: this.state.home.seq + 1
    }
    this.markDirty('home')
  }

  private _handleExtendedSysState(ess: common.ExtendedSysState): void {
    this.state.extendedState = {
      vtolState: ess.vtolState,
      landedState: ess.landedState,
      seq: this.state.extendedState.seq + 1
    }
    this.markDirty('extendedState')
  }

  private _handleVibration(vib: common.Vibration): void {
    this.state.vibration = {
      xVibration: vib.vibrationX,
      yVibration: vib.vibrationY,
      zVibration: vib.vibrationZ,
      clipping0: vib.clipping0,
      clipping1: vib.clipping1,
      clipping2: vib.clipping2,
      seq: this.state.vibration.seq + 1
    }
    this.markDirty('vibration')
  }

  private _handleRadioStatus(rs: common.RadioStatus): void {
    this.state.radio = {
      rssi: rs.rssi,
      remrssi: rs.remrssi,
      txbuf: rs.txbuf,
      noise: rs.noise,
      remnoise: rs.remnoise,
      rxerrors: rs.rxerrors,
      fixed: rs.fixed,
      seq: this.state.radio.seq + 1
    }
    this.markDirty('radio')
  }

  private _handleWind(w: Record<string, number>): void {
    this.state.wind = {
      direction: w['direction'] ?? 0,
      speed: w['speed'] ?? 0,
      verticalSpeed: w['speed_z'] ?? 0,
      seq: this.state.wind.seq + 1
    }
    this.markDirty('wind')
  }

  private _handleTerrainReport(tr: common.TerrainReport): void {
    this.state.terrain = {
      terrainAltitude: tr.terrainHeight,
      terrainValid: tr.terrainHeight !== 0,
      distanceToGround: tr.currentHeight,
      seq: this.state.terrain.seq + 1
    }
    this.markDirty('terrain')
  }

  private _handleMissionCurrent(mc: common.MissionCurrent): void {
    this.state.missionStatus = {
      ...this.state.missionStatus,
      currentIndex: mc.seq,
      seq: this.state.missionStatus.seq + 1
    }
    this.markDirty('missionStatus')
  }

  private _handleCameraInformation(ci: Record<string, unknown>): void {
    const flags = (ci['flags'] as number) ?? 0
    this.state.camera = {
      ...this.state.camera,
      discovered: true,
      hasCapVideo: !!(flags & 1), // CAMERA_CAP_FLAGS_CAPTURE_VIDEO
      hasCapImage: !!(flags & 2), // CAMERA_CAP_FLAGS_CAPTURE_IMAGE
      seq: this.state.camera.seq + 1
    }
    this.markDirty('camera')
  }

  private _handleCameraSettings(cs: Record<string, number>): void {
    this.state.camera = {
      ...this.state.camera,
      mode: cs['modeId'] ?? 0,
      seq: this.state.camera.seq + 1
    }
    this.markDirty('camera')
  }

  private _handleCameraCaptureStatus(cs: Record<string, number>): void {
    const imageStatus = cs['imageStatus'] ?? 0
    const videoStatus = cs['videoStatus'] ?? 0
    this.state.camera = {
      ...this.state.camera,
      isCapturingImage: imageStatus === 1 || imageStatus === 3,
      isRecordingVideo: videoStatus === 1,
      photoCount: cs['imageCount'] ?? this.state.camera.photoCount,
      videoRecordingTimeMs: cs['recordingTimeMs'] ?? 0,
      availableCapacityMib: cs['availableCapacity'] ?? 0,
      seq: this.state.camera.seq + 1
    }
    this.markDirty('camera')
  }

  setFirmwareVersion(major: number, minor: number, patch: number): void {
    if (
      this.state.core.firmwareVersionMajor !== major ||
      this.state.core.firmwareVersionMinor !== minor ||
      this.state.core.firmwareVersionPatch !== patch
    ) {
      this.state.core = {
        ...this.state.core,
        firmwareVersionMajor: major,
        firmwareVersionMinor: minor,
        firmwareVersionPatch: patch,
        seq: this.state.core.seq + 1
      }
      this.markDirty('core')
    }
  }

  setSysId(sysid: number): void {
    if (this.state.core.sysid !== sysid) {
      this.state.core.sysid = sysid
      this.state.core.seq++
      this.markDirty('core')
    }
  }

  setCompId(compid: number): void {
    if (this.state.core.compid !== compid) {
      this.state.core.compid = compid
      this.state.core.seq++
      this.markDirty('core')
    }
  }

  setCommunicationLost(lost: boolean): void {
    if (this.state.core.communicationLost !== lost) {
      this.state.core.communicationLost = lost
      this.state.core.seq++
      this.markDirty('core')
    }
  }

  updateCamera(partial: Partial<CameraGroup>): void {
    this.state.camera = {
      ...this.state.camera,
      ...partial,
      seq: this.state.camera.seq + 1
    }
    this.markDirty('camera')
  }

  setFlightModeName(name: string): void {
    this.state.core.flightModeName = name
    this.state.core.seq++
    this.markDirty('core')
  }

  /** Fast O(1) check: are any groups dirty? */
  hasDirty(): boolean {
    return this.dirtyCount > 0
  }

  /** Returns only changed groups and resets dirty flags. */
  getDelta(): VehicleDelta {
    const delta: VehicleDelta = {}
    for (const key of Object.keys(this.dirty) as VehicleGroupName[]) {
      if (this.dirty[key]) {
        // Use a typed helper to copy group into delta without `any`
        this._copyGroupToDelta(delta, key)
        this.dirty[key] = false
      }
    }
    this.dirtyCount = 0
    return delta
  }

  private _copyGroupToDelta(delta: VehicleDelta, key: VehicleGroupName): void {
    switch (key) {
      case 'battery':
        delta.battery = { ...this.state.battery, batteries: [...this.state.battery.batteries] }
        break
      case 'rc':
        delta.rc = { ...this.state.rc, channels: [...this.state.rc.channels] }
        break
      case 'core':
        delta.core = { ...this.state.core }
        break
      case 'attitude':
        delta.attitude = { ...this.state.attitude }
        break
      case 'gps':
        delta.gps = { ...this.state.gps }
        break
      case 'gpsRaw':
        delta.gpsRaw = { ...this.state.gpsRaw }
        break
      case 'home':
        delta.home = { ...this.state.home }
        break
      case 'vfrHud':
        delta.vfrHud = { ...this.state.vfrHud }
        break
      case 'sysStatus':
        delta.sysStatus = { ...this.state.sysStatus }
        break
      case 'wind':
        delta.wind = { ...this.state.wind }
        break
      case 'radio':
        delta.radio = { ...this.state.radio }
        break
      case 'vibration':
        delta.vibration = { ...this.state.vibration }
        break
      case 'extendedState':
        delta.extendedState = { ...this.state.extendedState }
        break
      case 'missionStatus':
        delta.missionStatus = { ...this.state.missionStatus }
        break
      case 'terrain':
        delta.terrain = { ...this.state.terrain }
        break
      case 'camera':
        delta.camera = { ...this.state.camera }
        break
      case 'servoOutput':
        delta.servoOutput = {
          ...this.state.servoOutput,
          outputs: [...this.state.servoOutput.outputs]
        }
        break
    }
  }

  getSnapshot(): VehicleSnapshot {
    return {
      core: { ...this.state.core },
      attitude: { ...this.state.attitude },
      gps: { ...this.state.gps },
      gpsRaw: { ...this.state.gpsRaw },
      home: { ...this.state.home },
      battery: { ...this.state.battery, batteries: [...this.state.battery.batteries] },
      rc: { ...this.state.rc, channels: [...this.state.rc.channels] },
      vfrHud: { ...this.state.vfrHud },
      sysStatus: { ...this.state.sysStatus },
      wind: { ...this.state.wind },
      radio: { ...this.state.radio },
      vibration: { ...this.state.vibration },
      extendedState: { ...this.state.extendedState },
      missionStatus: { ...this.state.missionStatus },
      terrain: { ...this.state.terrain },
      camera: { ...this.state.camera },
      servoOutput: { ...this.state.servoOutput, outputs: [...this.state.servoOutput.outputs] }
    }
  }

  getGroup<K extends VehicleGroupName>(key: K): VehicleSnapshot[K] {
    return { ...this.state[key] }
  }
}
