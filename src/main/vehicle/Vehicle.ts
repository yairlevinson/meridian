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
      this.commandQueue.setLink(link)
      this.missionManager.setLink(link)
      this.missionManager.setTarget(sysid, 1)
      this.parameterManager.setLink(link)
      this.parameterManager.setTarget(sysid, 1)
      this.calibrationManager.setLink(link)
      this.calibrationManager.setTarget(sysid)
      this.cameraManager.setLink(link)
      this.cameraManager.setTarget(sysid)
      this._wireFtpSend(link)
      this.emit('primaryLinkChanged', link)
    })
  }

  /** Add a link and set it as the command target */
  addLink(link: LinkInterface): void {
    this.linkManager.addLink(link)
    if (this.linkManager.linkCount === 1) {
      this.commandQueue.setLink(link)
      this.missionManager.setLink(link)
      this.missionManager.setTarget(this.sysid, 1)
      this.parameterManager.setLink(link)
      this.parameterManager.setTarget(this.sysid, 1)
      this.calibrationManager.setLink(link)
      this.calibrationManager.setTarget(this.sysid)
      this.cameraManager.setLink(link)
      this.cameraManager.setTarget(this.sysid)
      this._wireFtpSend(link)
    }
  }

  /** Set a writable link for sending commands (used in UDP mode) */
  setCommandLink(link: WritableLink): void {
    this.commandQueue.setLink(link)
    // PlanManager only calls writeBytes() on the link, so a plain WritableLink works fine.
    this.missionManager.setLink(link as LinkInterface)
    this.missionManager.setTarget(this.sysid, 1)
    this.parameterManager.setLink(link as LinkInterface)
    this.parameterManager.setTarget(this.sysid, 1)
    this.calibrationManager.setLink(link as LinkInterface)
    this.calibrationManager.setTarget(this.sysid)
    this.cameraManager.setLink(link as LinkInterface)
    this.cameraManager.setTarget(this.sysid)
    this._wireFtpSend(link)
  }

  /** Handle a decoded MAVLink message */
  handleMessage(msg: DecodedMessage, linkId: string): void {
    // Track heartbeats for communication loss detection
    if (msg.msgid === 0) {
      this.linkManager.heartbeatReceived(linkId)
    }

    // COMMAND_ACK is handled by the command queue
    if (msg.msgid === 77) {
      const ack = msg.data as { command: number; result: number }
      this.commandQueue.handleCommandAck(ack)
    }

    // PARAM_VALUE (22) is handled by the parameter manager
    if (msg.msgid === 22) {
      const pv = msg.data as {
        paramId: string
        paramValue: number
        paramType: number
        paramCount: number
        paramIndex: number
      }
      this.parameterManager.handleParamValue(pv)
    }

    // COMMAND_ACK — also forward calibration-related ACKs
    if (msg.msgid === 77) {
      const ack = msg.data as { command: number; result: number }
      this.calibrationManager.handleCommandAck(ack.command, ack.result)
    }

    // STATUSTEXT (253) — emit for calibration and UI status display
    if (msg.msgid === 253) {
      const st = msg.data as { severity: number; text: string }
      const text = st.text.replace(/\0/g, '')
      this.emit('statusText', { severity: st.severity, text })
      this.calibrationManager.handleStatusText(text, st.severity)
    }

    // MAG_CAL_PROGRESS (191)
    if (msg.msgid === 191) {
      this.calibrationManager.handleMagCalProgress(
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
    }

    // MAG_CAL_REPORT (192)
    if (msg.msgid === 192) {
      this.calibrationManager.handleMagCalReport(
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
    }

    // RC_CHANNELS (65) — feed live data to RC calibration manager
    if (msg.msgid === 65) {
      const rc = msg.data as { chancount: number; chan1Raw: number; chan2Raw: number; chan3Raw: number; chan4Raw: number; chan5Raw: number; chan6Raw: number; chan7Raw: number; chan8Raw: number; chan9Raw: number; chan10Raw: number; chan11Raw: number; chan12Raw: number; chan13Raw: number; chan14Raw: number; chan15Raw: number; chan16Raw: number; chan17Raw: number; chan18Raw: number }
      const channels = [
        rc.chan1Raw, rc.chan2Raw, rc.chan3Raw, rc.chan4Raw,
        rc.chan5Raw, rc.chan6Raw, rc.chan7Raw, rc.chan8Raw,
        rc.chan9Raw, rc.chan10Raw, rc.chan11Raw, rc.chan12Raw,
        rc.chan13Raw, rc.chan14Raw, rc.chan15Raw, rc.chan16Raw,
        rc.chan17Raw, rc.chan18Raw
      ]
      this.rcCalibrationManager.updateChannels(channels, rc.chancount)
    }

    // Camera protocol messages
    if (msg.msgid === 0) {
      // Heartbeat from a camera component (compid 100-105)
      const compid = (msg.data as { targetComponent?: number }).targetComponent
      if (compid !== undefined && compid >= 100 && compid <= 105) {
        this.cameraManager.handleCameraHeartbeat()
      }
    }
    if (msg.msgid === 259) {
      this.cameraManager.handleCameraInformation(msg.data as Record<string, unknown>)
    }
    if (msg.msgid === 260) {
      this.cameraManager.handleCameraSettings(msg.data as Record<string, number>)
    }
    if (msg.msgid === 261) {
      this.cameraManager.handleStorageInformation(msg.data as Record<string, number>)
    }
    if (msg.msgid === 262) {
      this.cameraManager.handleCaptureStatus(msg.data as Record<string, number>)
    }
    if (msg.msgid === 263) {
      this.cameraManager.handleImageCaptured(msg.data as Record<string, number>)
    }

    // SERIAL_CONTROL (126) — MAVLink console data from autopilot shell
    if (msg.msgid === 126) {
      const sc = msg.data as { device: number; flags: number; count: number; data: number[] }
      if (sc.device === 10) {
        // DEV_SHELL
        const bytes = sc.data.slice(0, sc.count)
        const text = Buffer.from(bytes).toString('utf8')
        if (text.length > 0) {
          this.emit('consoleData', { text })
        }
      }
    }

    // FILE_TRANSFER_PROTOCOL (110) — route to FTP manager
    if (msg.msgid === 110) {
      const ftpMsg = msg.data as { targetNetwork: number; targetSystem: number; targetComponent: number; payload: number[] }
      const buf = Buffer.from(ftpMsg.payload)
      if (buf.length >= 12) {
        const size = buf[4] ?? 0
        const response: FTPPayload = {
          seqNumber: buf.readUInt16LE(0),
          session: buf[2]!,
          opcode: buf[3]!,
          size,
          reqOpcode: buf[5]!,
          offset: buf.readUInt32LE(8),
          data: buf.subarray(12, 12 + size)
        }
        this.ftpManager.handleResponse(response)
      }
    }

    // COMPONENT_METADATA (397) — actuator metadata discovery (newer PX4)
    if (msg.msgid === 397) {
      const raw = msg.data as { _rawPayload?: Buffer }
      if (raw._rawPayload && raw._rawPayload.length >= 108) {
        // Wire format: time_boot_ms(4) + file_crc(4) + uri(char[100])
        const uri = raw._rawPayload.subarray(8, 108).toString('utf8').replace(/\0/g, '').trim()
        this.actuatorMetadata.handleComponentMetadata({ uri })
      }
    }

    // COMPONENT_INFORMATION (395) — actuator metadata discovery (legacy)
    if (msg.msgid === 395) {
      const ci = msg.data as { generalMetadataUri: string; generalMetadataFileCrc: number }
      this.actuatorMetadata.handleComponentInformation(ci)
    }

    // Auto-request parameters after first heartbeat
    if (msg.msgid === 0 && !this._parametersRequested) {
      this._parametersRequested = true
      // Delay slightly to let the link stabilize
      setTimeout(() => {
        this.parameterManager.requestAllParameters()
        // Request actuator metadata after parameters start loading
        setTimeout(() => this.actuatorMetadata.requestMetadata(), 3000)
      }, 1000)
    }

    // Mission protocol messages
    if (msg.msgid === 44) {
      // MISSION_COUNT
      this.missionManager.handleMissionCount((msg.data as { count: number }).count)
    } else if (msg.msgid === 73 || msg.msgid === 39) {
      // MISSION_ITEM_INT (73) or legacy MISSION_ITEM (39)
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
      this.missionManager.handleMissionItemInt(item)
    } else if (msg.msgid === 51 || msg.msgid === 40) {
      // MISSION_REQUEST_INT (51) or legacy MISSION_REQUEST (40)
      const reqSeq = (msg.data as { seq: number }).seq
      this.missionManager.handleMissionRequest(reqSeq)
    } else if (msg.msgid === 47) {
      // MISSION_ACK
      const ackType = (msg.data as { type: number }).type
      this.missionManager.handleMissionAck(ackType)
    } else if (msg.msgid === 42) {
      // MISSION_CURRENT
      this.missionManager.handleMissionCurrent((msg.data as { seq: number }).seq)
    }

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

  // ── Convenience command methods ─────────────────────────────────

  arm(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      400, // MAV_CMD_COMPONENT_ARM_DISARM
      this.sysid,
      0,
      { p1: 1 } // 1 = arm
    )
  }

  disarm(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      400,
      this.sysid,
      0,
      { p1: 0 } // 0 = disarm
    )
  }

  guidedTakeoff(altitude: number): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      22, // MAV_CMD_NAV_TAKEOFF
      this.sysid,
      0,
      { p7: altitude }
    )
  }

  guidedRTL(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
      this.sysid,
      0
    )
  }

  guidedLand(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      21, // MAV_CMD_NAV_LAND
      this.sysid,
      0
    )
  }

  guidedGoto(lat: number, lon: number, alt: number): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      192, // MAV_CMD_DO_REPOSITION
      this.sysid,
      0,
      { p1: -1, p2: 1, p4: NaN, p5: lat, p6: lon, p7: alt }
    )
  }

  guidedPause(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      252, // MAV_CMD_DO_PAUSE_CONTINUE
      this.sysid,
      0,
      { p1: 0 } // 0 = pause
    )
  }

  emergencyStop(): Promise<MavResult> {
    return this.commandQueue.sendCommand(
      400, // MAV_CMD_COMPONENT_ARM_DISARM
      this.sysid,
      0,
      { p1: 0, p2: 21196 } // 0 = disarm, 21196 = force/emergency
    )
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
      // Layout: seqNumber(2) session(1) opcode(1) size(1) reqOpcode(1) padding(2) offset(4) data(up to 239)
      const buf = Buffer.alloc(12 + payload.data.length)
      buf.writeUInt16LE(payload.seqNumber, 0)
      buf[2] = payload.session
      buf[3] = payload.opcode
      buf[4] = payload.size
      buf[5] = payload.reqOpcode
      // bytes 6-7: padding (0)
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
