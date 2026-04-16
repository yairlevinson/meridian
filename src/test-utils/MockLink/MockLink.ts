import { LinkInterface } from '../../main/links/LinkInterface'
import { LinkType, LinkConnectionStatus, type MockLinkConfig } from '@shared/ipc/LinkState'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { minimal, common } from 'mavlink-mappings'

export enum FailureMode {
  NoFailure = 'NoFailure',
  NoResponse = 'NoResponse',
  NoAck = 'NoAck',
  DropRandomSend = 'DropRandomSend'
}

/**
 * In-process mock link for testing.
 * MockVehicle writes bytes into this link which emits them as 'data' events.
 */
export class MockLink extends LinkInterface {
  /** Bytes sent from the "GCS side" (i.e., from the code under test) */
  readonly sentBuffers: Buffer[] = []
  private failureMode = FailureMode.NoFailure
  vehicleProtocol = new MavLinkProtocolV2(1, 1) // Vehicle sysid=1
  private vehicleSeq = 0

  constructor(id = 'mock-link-0') {
    const config: MockLinkConfig = {
      type: LinkType.Mock,
      name: 'MockLink',
      firmwareType: minimal.MavAutopilot.ARDUPILOTMEGA,
      vehicleType: minimal.MavType.QUADROTOR,
      sendStatusText: false
    }
    super(id, config)
  }

  async connect(): Promise<void> {
    this.setStatus(LinkConnectionStatus.Connected)
    this.emit('connected')
  }

  disconnect(): void {
    this.setStatus(LinkConnectionStatus.Disconnected)
    this.emit('disconnected')
  }

  writeBytes(buf: Buffer): void {
    if (this.failureMode === FailureMode.DropRandomSend && Math.random() < 0.5) {
      return
    }
    this.sentBuffers.push(Buffer.from(buf))
  }

  /** Inject bytes as if they came from the vehicle */
  injectData(buf: Buffer): void {
    this.emit('data', buf)
  }

  /** Inject a decoded MAVLink message as raw bytes from the vehicle side */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  injectMessage(msg: any): void {
    const buf = this.vehicleProtocol.serialize(msg, this.vehicleSeq++)
    this.injectData(buf)
  }

  /** Inject a HEARTBEAT from the mock vehicle */
  injectHeartbeat(armed = false): void {
    const hb = new minimal.Heartbeat()
    hb.type = (this.config as MockLinkConfig).vehicleType
    hb.autopilot = (this.config as MockLinkConfig).firmwareType
    hb.baseMode = armed
      ? minimal.MavModeFlag.SAFETY_ARMED | minimal.MavModeFlag.CUSTOM_MODE_ENABLED
      : minimal.MavModeFlag.CUSTOM_MODE_ENABLED
    hb.customMode = armed ? 4 : 0
    hb.systemStatus = minimal.MavState.ACTIVE
    this.injectMessage(hb)
  }

  /** Inject an ATTITUDE message */
  injectAttitude(roll: number, pitch: number, yaw: number): void {
    const att = new common.Attitude()
    att.timeBootMs = Date.now() >>> 0
    att.roll = roll
    att.pitch = pitch
    att.yaw = yaw
    att.rollspeed = 0
    att.pitchspeed = 0
    att.yawspeed = 0
    this.injectMessage(att)
  }

  /** Inject a GLOBAL_POSITION_INT message */
  injectPosition(lat: number, lon: number, alt: number, hdg = 0): void {
    const pos = new common.GlobalPositionInt()
    pos.timeBootMs = Date.now() >>> 0
    pos.lat = Math.round(lat * 1e7)
    pos.lon = Math.round(lon * 1e7)
    pos.alt = Math.round(alt * 1000)
    pos.relativeAlt = Math.round(alt * 1000)
    pos.vx = 0
    pos.vy = 0
    pos.vz = 0
    pos.hdg = Math.round(hdg * 100)
    this.injectMessage(pos)
  }

  /** Inject a SYS_STATUS message */
  injectSysStatus(voltage = 12600, current = 1500, remaining = 75): void {
    const ss = new common.SysStatus()
    ss.onboardControlSensorsPresent = 0xffff as number as typeof ss.onboardControlSensorsPresent
    ss.onboardControlSensorsEnabled = 0xfffe as number as typeof ss.onboardControlSensorsEnabled
    ss.onboardControlSensorsHealth = 0xfffd as number as typeof ss.onboardControlSensorsHealth
    ss.load = 250
    ss.voltageBattery = voltage
    ss.currentBattery = current
    ss.batteryRemaining = remaining
    ss.dropRateComm = 0
    ss.errorsComm = 0
    this.injectMessage(ss)
  }

  /** Inject a COMMAND_ACK */
  injectCommandAck(command: number, result = 0): void {
    const ack = new common.CommandAck()
    ack.command = command
    ack.result = result
    ack.targetSystem = 255
    ack.targetComponent = 190
    this.injectMessage(ack)
  }

  /** Inject a BATTERY_STATUS message */
  injectBatteryStatus(id = 0, voltage = 12600, current = 1500, remaining = 75): void {
    const bat = new common.BatteryStatus()
    bat.id = id
    bat.voltages = [voltage, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535]
    bat.currentBattery = current
    bat.batteryRemaining = remaining
    bat.temperature = 3500
    this.injectMessage(bat)
  }

  /** Set failure mode for testing error handling */
  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode
  }
}
