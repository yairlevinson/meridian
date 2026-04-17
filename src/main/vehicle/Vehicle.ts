import { EventEmitter } from 'events'
import { VehicleState, type VehicleDelta } from '../vehicleState'
import { MavCommandQueue, type WritableLink } from './MavCommandQueue'
import { VehicleLinkManager } from './VehicleLinkManager'
import { MissionManager } from '../mission/MissionManager'
import { ParameterManager } from '../parameters/ParameterManager'
import { CalibrationManager } from '../calibration/CalibrationManager'
import { RcCalibrationManager } from '../calibration/RcCalibrationManager'
import { FirmwareManager } from '../firmware/FirmwareManager'
import { FTPManager, type FTPPayload } from '../ftp/FTPManager'
import { CameraManager } from '../camera/CameraManager'
import { ActuatorMetadataManager } from '../actuators/ActuatorMetadataManager'
import type { LinkInterface } from '../links/LinkInterface'
import type { DecodedMessage } from '../mavlink/MavlinkChannel'
import { MavResult } from '@shared/ipc/MavCommandRequest'
import { MissionType, type MissionItem } from '@shared/ipc/MissionTypes'
import { common } from 'mavlink-mappings'
import { createGcsProtocol } from '../mavlink/constants'
import { createLogger } from '../logger'
import {
  dialectForAutopilot,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  type ActionStep,
  type VehicleDialect
} from './dialect'
import type { VehicleContext, VehicleSubsystem } from './VehicleContext'

const log = createLogger('Vehicle')

/**
 * Represents a single MAVLink vehicle.
 * Combines VehicleState, MavCommandQueue, and VehicleLinkManager.
 */
export class Vehicle extends EventEmitter {
  readonly sysid: number
  readonly state: VehicleState
  readonly commandQueue: MavCommandQueue
  readonly linkManager: VehicleLinkManager
  readonly missionManager: MissionManager
  readonly parameterManager: ParameterManager
  readonly calibrationManager: CalibrationManager
  readonly rcCalibrationManager: RcCalibrationManager
  readonly firmwareManager: FirmwareManager
  readonly ftpManager: FTPManager
  readonly cameraManager: CameraManager
  readonly actuatorMetadata: ActuatorMetadataManager
  private _parametersRequested = false
  private _ftpSeq = 0
  private _commandLink: WritableLink | null = null
  _chunkedStatusTexts: Map<
    number,
    { severity: number; chunks: string[]; timer: ReturnType<typeof setTimeout> }
  > | null = null

  constructor(
    sysid: number,
    options: { heartbeatMaxElapsedMs?: number; commLostCheckMs?: number } = {}
  ) {
    super()
    this.sysid = sysid
    this.state = new VehicleState()
    this.state.setSysId(sysid)
    this.commandQueue = new MavCommandQueue()
    this.missionManager = new MissionManager()
    this.parameterManager = new ParameterManager()
    this.calibrationManager = new CalibrationManager()
    this.rcCalibrationManager = new RcCalibrationManager()
    this.rcCalibrationManager.setParameterManager(this.parameterManager)
    this.ftpManager = new FTPManager()
    this.firmwareManager = new FirmwareManager()
    this.firmwareManager.setFtpManager(this.ftpManager)
    this.firmwareManager.setCommandQueue(this.commandQueue)
    this.firmwareManager.setSysId(sysid)
    this.cameraManager = new CameraManager()
    this.actuatorMetadata = new ActuatorMetadataManager()
    this.actuatorMetadata.setCommandQueue(this.commandQueue)
    this.actuatorMetadata.setFtpManager(this.ftpManager)
    this.actuatorMetadata.setTarget(sysid)
    this.linkManager = new VehicleLinkManager(options)

    this.linkManager.on('communicationLost', () => {
      this.state.setCommunicationLost(true)
      this.emit('communicationLost')
    })

    this.linkManager.on('communicationRestored', () => {
      this.state.setCommunicationLost(false)
      this.emit('communicationRestored')
    })

    this.linkManager.on('primaryLinkChanged', (link: LinkInterface) => {
      this._rebind(link)
      this.emit('primaryLinkChanged', link)
    })
  }

  /** Add a link and set it as the command target */
  addLink(link: LinkInterface): void {
    this.linkManager.addLink(link)
    if (this.linkManager.linkCount === 1) this._rebind(link)
  }

  /** Set a writable link for sending commands (used in UDP mode).
   * PlanManager/Parameter/etc. only call writeBytes() on the link, so a plain
   * WritableLink works. commandQueue.setLink() is called directly to preserve
   * its WritableLink-accepting signature.
   */
  setCommandLink(link: WritableLink): void {
    this._commandLink = link
    this.commandQueue.setLink(link)
    this._bindSubsystems(link as LinkInterface)
    this._wireFtpSend(link)
  }

  /** Rebuild the shared context and (re)bind all VehicleSubsystems to it. */
  private _rebind(link: LinkInterface): void {
    this._commandLink = link
    this._bindSubsystems(link)
    this._wireFtpSend(link)
  }

  /** Bind all link-dependent subsystems to a freshly-built VehicleContext. */
  private _bindSubsystems(link: LinkInterface): void {
    const ctx: VehicleContext = {
      sysid: this.sysid,
      compid: 1, // MAV_COMP_ID_AUTOPILOT1 — camera manager keeps its own comp id
      link,
      dialect: this.dialect
    }
    const subsystems: VehicleSubsystem[] = [
      this.commandQueue,
      this.missionManager,
      this.parameterManager,
      this.calibrationManager,
      this.cameraManager
    ]
    for (const s of subsystems) s.bind(ctx)
  }

  // ── Message dispatch table ───────────────────────────────────────
  // Each handler receives the Vehicle instance and the decoded message.
  // state.handleMessage() always runs after dispatch (see handleMessage below).
  private static readonly DISPATCH: Record<
    number,
    (v: Vehicle, msg: DecodedMessage, linkId: string) => void
  > = {
    // HEARTBEAT (0) — link tracking, camera component, auto-request params
    0: (v, msg, linkId) => {
      v.linkManager.heartbeatReceived(linkId)

      // Heartbeat from a camera component (compid 100-105)
      const compid = (msg.data as { targetComponent?: number }).targetComponent
      if (compid !== undefined && compid >= 100 && compid <= 105) {
        v.cameraManager.handleCameraHeartbeat()
      }

      // Pass autopilot type to RC calibration manager for correct param names
      const hbData = msg.data as { autopilot?: number }
      if (hbData.autopilot !== undefined) {
        v.rcCalibrationManager.setAutopilotType(hbData.autopilot)
      }

      // Auto-request parameters after first heartbeat
      if (!v._parametersRequested) {
        v._parametersRequested = true
        setTimeout(() => {
          v.parameterManager.requestAllParameters()
          v.missionManager.loadFromVehicle()
          setTimeout(() => v.actuatorMetadata.requestMetadata(), 3000)
        }, 1000)
      }
    },

    // PARAM_VALUE (22)
    22: (v, msg) => {
      v.parameterManager.handleParamValue(
        msg.data as {
          paramId: string
          paramValue: number
          paramType: number
          paramCount: number
          paramIndex: number
        }
      )
    },

    // MISSION_COUNT (44)
    44: (v, msg) => {
      v.missionManager.handleMissionCount((msg.data as { count: number }).count)
    },

    // MISSION_ITEM (39, legacy)
    39: (v, msg) => Vehicle._handleMissionItem(v, msg),

    // MISSION_REQUEST (40, legacy)
    40: (v, msg) => {
      v.missionManager.handleMissionRequest((msg.data as { seq: number }).seq)
    },

    // MISSION_CURRENT (42)
    42: (v, msg) => {
      v.missionManager.handleMissionCurrent((msg.data as { seq: number }).seq)
    },

    // MISSION_ACK (47)
    47: (v, msg) => {
      v.missionManager.handleMissionAck((msg.data as { type: number }).type)
    },

    // MISSION_REQUEST_INT (51)
    51: (v, msg) => {
      v.missionManager.handleMissionRequest((msg.data as { seq: number }).seq)
    },

    // RC_CHANNELS (65)
    65: (v, msg) => {
      const rc = msg.data as {
        chancount: number
        chan1Raw: number
        chan2Raw: number
        chan3Raw: number
        chan4Raw: number
        chan5Raw: number
        chan6Raw: number
        chan7Raw: number
        chan8Raw: number
        chan9Raw: number
        chan10Raw: number
        chan11Raw: number
        chan12Raw: number
        chan13Raw: number
        chan14Raw: number
        chan15Raw: number
        chan16Raw: number
        chan17Raw: number
        chan18Raw: number
      }
      const channels: number[] = [
        rc.chan1Raw,
        rc.chan2Raw,
        rc.chan3Raw,
        rc.chan4Raw,
        rc.chan5Raw,
        rc.chan6Raw,
        rc.chan7Raw,
        rc.chan8Raw,
        rc.chan9Raw,
        rc.chan10Raw,
        rc.chan11Raw,
        rc.chan12Raw,
        rc.chan13Raw,
        rc.chan14Raw,
        rc.chan15Raw,
        rc.chan16Raw,
        rc.chan17Raw,
        rc.chan18Raw
      ]
      v.rcCalibrationManager.updateChannels(channels, rc.chancount)
    },

    // MISSION_ITEM_INT (73)
    73: (v, msg) => Vehicle._handleMissionItem(v, msg),

    // COMMAND_ACK (77) — route to queue or calibration, never both for cmd 241
    77: (v, msg) => {
      const ack = msg.data as { command: number; result: number }
      log.debug('COMMAND_ACK cmd=%d result=%d', ack.command, ack.result)
      if (ack.command === 241 && v.calibrationManager.isCalibrating) {
        // Calibration owns PREFLIGHT_CALIBRATION ACKs when active
        v.calibrationManager.handleCommandAck(ack.command, ack.result)
      } else {
        v.commandQueue.handleCommandAck(ack)
        v.calibrationManager.handleCommandAck(ack.command, ack.result)
      }
    },

    // FILE_TRANSFER_PROTOCOL (110)
    110: (v, msg) => {
      const ftpMsg = msg.data as {
        targetNetwork: number
        targetSystem: number
        targetComponent: number
        payload: number[]
      }
      const buf = Buffer.from(ftpMsg.payload)
      if (buf.length >= 12) {
        const size = buf[4] ?? 0
        const response: FTPPayload = {
          seqNumber: buf.readUInt16LE(0),
          session: buf[2]!,
          opcode: buf[3]!,
          size,
          reqOpcode: buf[5]!,
          burstComplete: buf[6]!,
          offset: buf.readUInt32LE(8),
          data: buf.subarray(12, 12 + size)
        }
        v.ftpManager.handleResponse(response)
      }
    },

    // SERIAL_CONTROL (126) — MAVLink console
    126: (v, msg) => {
      const sc = msg.data as { device: number; flags: number; count: number; data: number[] }
      if (sc.device === 10) {
        const bytes = sc.data.slice(0, sc.count)
        const text = Buffer.from(bytes).toString('utf8')
        if (text.length > 0) {
          v.emit('consoleData', { text })
        }
      }
    },

    // AUTOPILOT_VERSION (148) — firmware version
    148: (v, msg) => {
      const raw = msg.data as { _rawPayload?: Buffer }
      if (raw._rawPayload && raw._rawPayload.length >= 12) {
        const swVer = raw._rawPayload.readUInt32LE(8)
        if (swVer !== 0) {
          const major = (swVer >> 24) & 0xff
          const minor = (swVer >> 16) & 0xff
          const patch = (swVer >> 8) & 0xff
          v.state.setFirmwareVersion(major, minor, patch)
        }
      }
    },

    // MAG_CAL_PROGRESS (191)
    191: (v, msg) => {
      v.calibrationManager.handleMagCalProgress(
        msg.data as {
          compassId: number
          calMask: number
          calStatus: number
          attempt: number
          completionPct: number
          completionMask: number[]
          directionX: number
          directionY: number
          directionZ: number
        }
      )
    },

    // MAG_CAL_REPORT (192)
    192: (v, msg) => {
      v.calibrationManager.handleMagCalReport(
        msg.data as {
          compassId: number
          calMask: number
          calStatus: number
          autosaved: number
          fitness: number
          ofsX: number
          ofsY: number
          ofsZ: number
        }
      )
    },

    // STATUSTEXT (253) — with chunked message reassembly
    253: (v, msg) => {
      const st = msg.data as { severity: number; text: string; id?: number; chunkSeq?: number }
      const text = st.text.replace(/\0/g, '')
      const chunkId = st.id ?? 0

      if (chunkId === 0) {
        // Non-chunked message — emit immediately
        log.debug('STATUSTEXT sev=%d: %s', st.severity, text)
        v.emit('statusText', { severity: st.severity, text })
        v.calibrationManager.handleStatusText(text, st.severity)
      } else {
        // Chunked message — reassemble
        if (!v._chunkedStatusTexts) v._chunkedStatusTexts = new Map()
        const existing = v._chunkedStatusTexts.get(chunkId)
        if (existing) {
          existing.chunks.push(text)
          clearTimeout(existing.timer)
        } else {
          v._chunkedStatusTexts.set(chunkId, {
            severity: st.severity,
            chunks: [text],
            timer: 0 as unknown as ReturnType<typeof setTimeout>
          })
        }
        const entry = v._chunkedStatusTexts.get(chunkId)!
        // If text is shorter than 50 chars (has null terminator), it's the last chunk
        const isLast = st.text.length < 50 || st.text.includes('\0')
        const flush = (): void => {
          const fullText = entry.chunks.join('')
          log.debug('STATUSTEXT sev=%d: %s', entry.severity, fullText)
          v.emit('statusText', { severity: entry.severity, text: fullText })
          v.calibrationManager.handleStatusText(fullText, entry.severity)
          v._chunkedStatusTexts!.delete(chunkId)
        }
        if (isLast) {
          flush()
        } else {
          // Timeout: flush after 1s if no more chunks arrive
          entry.timer = setTimeout(flush, 1000)
        }
      }
    },

    // CAMERA_INFORMATION (259)
    259: (v, msg) => v.cameraManager.handleCameraInformation(msg.data as Record<string, unknown>),
    // CAMERA_SETTINGS (260)
    260: (v, msg) => v.cameraManager.handleCameraSettings(msg.data as Record<string, number>),
    // STORAGE_INFORMATION (261)
    261: (v, msg) => v.cameraManager.handleStorageInformation(msg.data as Record<string, number>),
    // CAMERA_CAPTURE_STATUS (262)
    262: (v, msg) => v.cameraManager.handleCaptureStatus(msg.data as Record<string, number>),
    // IMAGE_CAPTURED (263)
    263: (v, msg) => v.cameraManager.handleImageCaptured(msg.data as Record<string, number>),

    // COMPONENT_INFORMATION (395) — actuator metadata (legacy)
    395: (v, msg) => {
      v.actuatorMetadata.handleComponentInformation(
        msg.data as { generalMetadataUri: string; generalMetadataFileCrc: number }
      )
    },

    // COMPONENT_METADATA (397) — actuator metadata (newer PX4)
    397: (v, msg) => {
      const raw = msg.data as { _rawPayload?: Buffer }
      if (raw._rawPayload && raw._rawPayload.length >= 108) {
        const uri = raw._rawPayload.subarray(8, 108).toString('utf8').replace(/\0/g, '').trim()
        v.actuatorMetadata.handleComponentMetadata({ uri })
      }
    }
  }

  /** Convert raw mission item data to MissionItem */
  private static _handleMissionItem(v: Vehicle, msg: DecodedMessage): void {
    const d = msg.data as {
      seq: number
      frame: number
      command: number
      current: number
      autocontinue: number
      param1: number
      param2: number
      param3: number
      param4: number
      x: number
      y: number
      z: number
      missionType: number
    }
    const item: MissionItem = {
      seq: d.seq,
      frame: d.frame,
      command: d.command,
      current: d.current !== 0,
      autocontinue: d.autocontinue !== 0,
      param1: d.param1,
      param2: d.param2,
      param3: d.param3,
      param4: d.param4,
      x: d.x,
      y: d.y,
      z: d.z,
      missionType: d.missionType as MissionType
    }
    v.missionManager.handleMissionItemInt(item)
  }

  /** Handle a decoded MAVLink message */
  handleMessage(msg: DecodedMessage, linkId: string): void {
    const handler = Vehicle.DISPATCH[msg.msgid]
    if (handler) handler(this, msg, linkId)

    // All messages update the vehicle state
    this.state.handleMessage(msg.msgid, msg.data)
  }

  /** Fast O(1) check: are any groups dirty? */
  hasDirty(): boolean {
    return this.state.hasDirty()
  }

  /** Get the current delta (changed groups since last call) */
  getDelta(): VehicleDelta {
    return this.state.getDelta()
  }

  // ── Autopilot detection ─────────────────────────────────────────

  /** Dialect for the currently-detected autopilot family (from HEARTBEAT). */
  get dialect(): VehicleDialect {
    return dialectForAutopilot(this.state.getSnapshot().core.autopilot)
  }

  /**
   * Switch the vehicle to the named flight mode. Resolves the dialect-specific
   * custom_mode and dispatches via either SET_MODE (PX4) or DO_SET_MODE (ArduPilot).
   * Returns MavResult.UNSUPPORTED if the name is unknown for this autopilot.
   */
  async setFlightModeByName(name: string): Promise<MavResult> {
    const dialect = this.dialect
    const customMode = dialect.modeNameToCustomMode(name)
    log.log(
      `setFlightMode sysid=${this.sysid} mode=${name} dialect=${dialect.name} customMode=${customMode}`
    )
    if (customMode === null) {
      log.error(`setFlightMode: unknown mode name '${name}' for ${dialect.name}`)
      return MavResult.UNSUPPORTED
    }
    if (dialect.usesSetModeMessage) {
      this.sendSetMode(MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode)
      return MavResult.ACCEPTED
    }
    return this.commandQueue.sendCommand(common.MavCmd.DO_SET_MODE, this.sysid, 0, {
      p1: 1,
      p2: customMode
    })
  }

  // ── Action plan executor ──────────────────────────────────────

  /**
   * Execute an action plan from CommandSemantics.
   * Steps execute sequentially — each command waits for ACK before proceeding.
   * Returns the result of the last step (or first failure).
   */
  private async executePlan(steps: ActionStep[]): Promise<MavResult> {
    for (const step of steps) {
      let result: MavResult
      switch (step.type) {
        case 'command':
          result = await this.commandQueue.sendCommand(step.command, this.sysid, 0, step.params)
          if (result !== MavResult.ACCEPTED) return result
          break

        case 'mode':
          this.sendSetMode(step.baseMode, step.customMode)
          result = MavResult.ACCEPTED
          break

        case 'arm':
          result = await this.commandQueue.sendCommand(400, this.sysid, 0, { p1: 1 })
          if (result !== MavResult.ACCEPTED) return result
          break
      }
    }
    return MavResult.ACCEPTED
  }

  // ── Convenience command methods ─────────────────────────────────

  arm(): Promise<MavResult> {
    return this.executePlan(this.dialect.planArm())
  }

  forceArm(): Promise<MavResult> {
    log.debug('forceArm: bypassing preflight checks')
    return this.executePlan(this.dialect.planForceArm())
  }

  disarm(): Promise<MavResult> {
    return this.executePlan(this.dialect.planDisarm())
  }

  /** Send SET_MODE message (msg id 11) — used for PX4 which doesn't support DO_SET_MODE */
  sendSetMode(baseMode: number, customMode: number): void {
    const link = this._commandLink
    if (!link) return
    const msg = new common.SetMode()
    msg.targetSystem = this.sysid
    msg.baseMode = baseMode
    msg.customMode = customMode
    const protocol = createGcsProtocol()
    link.writeBytes(protocol.serialize(msg, 0))
    log.debug('sendSetMode: target=%d baseMode=%d customMode=%d', this.sysid, baseMode, customMode)
  }

  async guidedTakeoff(altitude: number): Promise<MavResult> {
    const snapshot = this.state.getSnapshot()
    const currentAltMsl = snapshot.gps.alt
    if (!currentAltMsl || currentAltMsl === 0) {
      log.warn('guidedTakeoff: no GPS altitude available')
    }
    const dialect = this.dialect
    log.debug('guidedTakeoff %s: relAlt=%d currentMSL=%d', dialect.name, altitude, currentAltMsl)
    return this.executePlan(dialect.planTakeoff({ altitude, currentAltMsl }))
  }

  guidedRTL(): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('guidedRTL %s', dialect.name)
    return this.executePlan(dialect.planRtl())
  }

  guidedLand(): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('guidedLand %s', dialect.name)
    return this.executePlan(dialect.planLand())
  }

  guidedGoto(lat: number, lon: number, alt: number): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('guidedGoto %s: lat=%f lon=%f alt=%f', dialect.name, lat, lon, alt)
    return this.executePlan(dialect.planGoto({ lat, lon, alt }))
  }

  guidedPause(): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('guidedPause %s', dialect.name)
    return this.executePlan(dialect.planPause())
  }

  missionStart(): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('missionStart %s', dialect.name)
    return this.executePlan(dialect.planMissionStart())
  }

  emergencyStop(): Promise<MavResult> {
    log.debug('emergencyStop')
    return this.executePlan(this.dialect.planEmergencyStop())
  }

  /**
   * Change in-flight altitude. `newAltRel` is the desired altitude above the home
   * position in meters (matches the alt displayed in the fly view).
   * Internally converted to AMSL using the vehicle's home altitude.
   */
  guidedChangeAltitude(newAltRel: number): Promise<MavResult> {
    const snap = this.state.getSnapshot()
    if (!snap.home.valid) {
      log.warn('guidedChangeAltitude: no valid home position')
      return Promise.resolve(MavResult.TEMPORARILY_REJECTED)
    }
    const altMsl = snap.home.alt + newAltRel
    const lat = snap.gps.lat
    const lon = snap.gps.lon
    const dialect = this.dialect
    log.debug('guidedChangeAltitude %s: newAltRel=%f altMsl=%f', dialect.name, newAltRel, altMsl)
    return this.executePlan(dialect.planChangeAltitude({ lat, lon, altMsl }))
  }

  /**
   * Rotate to an absolute heading in degrees (0 = north, clockwise positive).
   * PX4 uses DO_REPOSITION with yaw; ArduPilot uses CONDITION_YAW.
   */
  guidedChangeHeading(headingDeg: number): Promise<MavResult> {
    const wrapped = ((headingDeg % 360) + 360) % 360
    const dialect = this.dialect
    let yawRateLimit = 0
    if (dialect.name === 'ardupilot') {
      const p = this.parameterManager.getParameter('ATC_RATE_Y_MAX')
      if (p && typeof p.value === 'number' && p.value > 0) yawRateLimit = p.value
    }
    log.debug('guidedChangeHeading %s: heading=%f', dialect.name, wrapped)
    return this.executePlan(dialect.planChangeHeading({ headingDeg: wrapped, yawRateLimit }))
  }

  /**
   * Change flight speed. `speedType`: 0 = airspeed, 1 = groundspeed (MAV_CMD_DO_CHANGE_SPEED).
   */
  guidedChangeSpeed(speed: number, speedType: 0 | 1 = 1): Promise<MavResult> {
    const dialect = this.dialect
    log.debug('guidedChangeSpeed %s: type=%d speed=%f', dialect.name, speedType, speed)
    return this.executePlan(dialect.planChangeSpeed({ speedType, speed }))
  }

  /**
   * Orbit a point. Radius sign encodes direction (negative = CCW).
   * `altRel` is altitude above home, converted to AMSL.
   */
  guidedOrbit(lat: number, lon: number, radius: number, altRel: number): Promise<MavResult> {
    const snap = this.state.getSnapshot()
    if (!snap.home.valid) {
      log.warn('guidedOrbit: no valid home position')
      return Promise.resolve(MavResult.TEMPORARILY_REJECTED)
    }
    const altMsl = snap.home.alt + altRel
    const dialect = this.dialect
    log.debug(
      'guidedOrbit %s: center=(%f,%f) radius=%f altMsl=%f',
      dialect.name,
      lat,
      lon,
      radius,
      altMsl
    )
    return this.executePlan(dialect.planOrbit({ lat, lon, radius, altMsl }))
  }

  landingGearDeploy(): Promise<MavResult> {
    log.debug('landingGearDeploy')
    return this.executePlan(this.dialect.planLandingGear({ state: 0 }))
  }

  landingGearRetract(): Promise<MavResult> {
    log.debug('landingGearRetract')
    return this.executePlan(this.dialect.planLandingGear({ state: 1 }))
  }

  private consoleProtocol = createGcsProtocol()
  private consoleSeq = 0

  /** Send text to the autopilot's MAVLink shell via SERIAL_CONTROL */
  sendConsoleText(text: string): void {
    const link = this.commandQueue['link'] as WritableLink | null
    if (!link) return

    const textWithNewline = text.endsWith('\n') ? text : text + '\n'
    const bytes = Buffer.from(textWithNewline, 'utf8')

    // SERIAL_CONTROL has a 70-byte data limit — split if needed
    for (let offset = 0; offset < bytes.length; offset += 70) {
      const chunk = bytes.subarray(offset, Math.min(offset + 70, bytes.length))
      const msg = new common.SerialControl()
      msg.device = 10 // DEV_SHELL
      msg.flags = 2 // RESPOND
      msg.timeout = 0
      msg.baudrate = 0
      msg.count = chunk.length
      // Fill the 70-byte data array
      msg.data = Array.from({ length: 70 }, (_, i) => (i < chunk.length ? chunk[i]! : 0))

      const buf = this.consoleProtocol.serialize(msg, this.consoleSeq++ & 0xff)
      link.writeBytes(buf)
    }
  }

  /** Wire FTP send function so FTPManager can send FILE_TRANSFER_PROTOCOL messages */
  private _wireFtpSend(link: WritableLink): void {
    const protocol = createGcsProtocol()
    this.ftpManager.setSendFunction((payload: FTPPayload) => {
      const msg = new common.FileTransferProtocol()
      msg.targetNetwork = 0
      msg.targetSystem = this.sysid
      msg.targetComponent = 1 // MAV_COMP_ID_AUTOPILOT1

      // Encode FTP payload into the 251-byte payload field
      // Layout: seqNumber(2) session(1) opcode(1) size(1) reqOpcode(1) burstComplete(1) padding(1) offset(4) data(up to 239)
      const buf = Buffer.alloc(12 + payload.data.length)
      buf.writeUInt16LE(payload.seqNumber, 0)
      buf[2] = payload.session
      buf[3] = payload.opcode
      buf[4] = payload.size
      buf[5] = payload.reqOpcode
      buf[6] = payload.burstComplete
      // byte 7: padding (0)
      buf.writeUInt32LE(payload.offset, 8)
      payload.data.copy(buf, 12)

      msg.payload = Array.from(buf)
      const serialized = protocol.serialize(msg, this._ftpSeq++ & 0xff)
      link.writeBytes(serialized)
    })
  }

  destroy(): void {
    this.commandQueue.clear()
    this.missionManager.destroy()
    this.parameterManager.destroy()
    this.calibrationManager.destroy()
    this.rcCalibrationManager.destroy()
    this.firmwareManager.destroy()
    this.ftpManager.destroy()
    this.cameraManager.destroy()
    this.actuatorMetadata.destroy()
    this.linkManager.destroy()
  }
}
