import { EventEmitter } from 'events'
import { common } from 'mavlink-mappings'
import type { LinkInterface } from '../links/LinkInterface'
import { createGcsProtocol } from '../mavlink/constants'

export interface GimbalState {
  pitch: number // degrees
  roll: number // degrees
  yaw: number // degrees
  pitchRate: number // deg/s
  rollRate: number // deg/s
  yawRate: number // deg/s
}

/**
 * Controls a MAVLink gimbal via GIMBAL_MANAGER_SET_PITCHYAW (msgid=287).
 * Receives attitude from GIMBAL_DEVICE_ATTITUDE_STATUS (msgid=285).
 */
export class GimbalController extends EventEmitter {
  private state: GimbalState = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0
  }
  private protocol = createGcsProtocol()
  private seq = 0
  private link: LinkInterface | null = null
  private targetSystem = 1
  private gimbalDeviceId = 0

  setLink(link: LinkInterface): void {
    this.link = link
  }

  setTarget(sysid: number, gimbalId: number): void {
    this.targetSystem = sysid
    this.gimbalDeviceId = gimbalId
  }

  /** Handle GIMBAL_DEVICE_ATTITUDE_STATUS */
  handleAttitudeStatus(data: {
    q: number[] // quaternion [w, x, y, z]
    angularVelocityX: number
    angularVelocityY: number
    angularVelocityZ: number
  }): void {
    // Convert quaternion to euler angles
    const [w, x, y, z] = data.q
    if (w === undefined || x === undefined || y === undefined || z === undefined) return

    const RAD_TO_DEG = 180 / Math.PI
    const sinr = 2 * (w * x + y * z)
    const cosr = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinr, cosr) * RAD_TO_DEG

    const sinp = 2 * (w * y - z * x)
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * 90 : Math.asin(sinp) * RAD_TO_DEG

    const siny = 2 * (w * z + x * y)
    const cosy = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(siny, cosy) * RAD_TO_DEG

    this.state = {
      pitch,
      roll,
      yaw,
      pitchRate: data.angularVelocityX * RAD_TO_DEG,
      rollRate: data.angularVelocityY * RAD_TO_DEG,
      yawRate: data.angularVelocityZ * RAD_TO_DEG
    }
    this.emit('attitudeChanged', this.state)
  }

  /** Command gimbal to pitch/yaw angles */
  setAngles(pitch: number, yaw: number): void {
    if (!this.link) return

    const DEG_TO_RAD = Math.PI / 180
    const cmd = new common.CommandLong()
    cmd.targetSystem = this.targetSystem
    cmd.targetComponent = this.gimbalDeviceId
    cmd.command = 1000 // MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW
    cmd._param1 = pitch * DEG_TO_RAD // pitch in rad
    cmd._param2 = yaw * DEG_TO_RAD // yaw in rad
    cmd._param5 = 2 // GIMBAL_MANAGER_FLAGS_YAW_LOCK

    this.link.writeBytes(this.protocol.serialize(cmd, this.seq++))
  }

  get currentState(): GimbalState {
    return { ...this.state }
  }
}
