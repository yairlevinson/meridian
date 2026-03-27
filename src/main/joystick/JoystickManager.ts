import { EventEmitter } from 'events'

export interface JoystickState {
  axes: number[] // -1.0 to 1.0
  buttons: boolean[]
  connected: boolean
  name: string
}

export interface JoystickConfig {
  deadband: number // 0-1 (fraction of full range)
  expo: number // exponential curve factor (0 = linear, 1 = max expo)
  rollAxis: number
  pitchAxis: number
  yawAxis: number
  throttleAxis: number
}

const DEFAULT_CONFIG: JoystickConfig = {
  deadband: 0.05,
  expo: 0.3,
  rollAxis: 0,
  pitchAxis: 1,
  yawAxis: 3,
  throttleAxis: 2
}

/**
 * Manages gamepad input for manual/guided vehicle control.
 * Applies deadband, expo curves, and rate limiting.
 * Outputs RC_CHANNELS_OVERRIDE or SET_ATTITUDE_TARGET at 30Hz.
 */
export class JoystickManager extends EventEmitter {
  private config: JoystickConfig
  private state: JoystickState = {
    axes: [],
    buttons: [],
    connected: false,
    name: ''
  }
  private outputInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<JoystickConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Update joystick state from gamepad API */
  updateState(state: JoystickState): void {
    this.state = state
    if (state.connected && !this.outputInterval) {
      this._startOutput()
    } else if (!state.connected && this.outputInterval) {
      this._stopOutput()
    }
  }

  /** Get current processed axes (after deadband + expo) */
  getProcessedAxes(): { roll: number; pitch: number; yaw: number; throttle: number } {
    return {
      roll: this._processAxis(this.state.axes[this.config.rollAxis] ?? 0),
      pitch: this._processAxis(this.state.axes[this.config.pitchAxis] ?? 0),
      yaw: this._processAxis(this.state.axes[this.config.yawAxis] ?? 0),
      throttle: this._processAxis(this.state.axes[this.config.throttleAxis] ?? 0)
    }
  }

  get isConnected(): boolean {
    return this.state.connected
  }

  get joystickName(): string {
    return this.state.name
  }

  setConfig(config: Partial<JoystickConfig>): void {
    this.config = { ...this.config, ...config }
  }

  destroy(): void {
    this._stopOutput()
  }

  private _processAxis(raw: number): number {
    // Apply deadband
    if (Math.abs(raw) < this.config.deadband) return 0

    // Scale remaining range to 0-1
    const sign = raw > 0 ? 1 : -1
    const scaled = (Math.abs(raw) - this.config.deadband) / (1 - this.config.deadband)

    // Apply expo curve: output = (1-expo)*scaled + expo*scaled^3
    const expo = this.config.expo
    const output = (1 - expo) * scaled + expo * scaled * scaled * scaled

    return sign * Math.min(1, output)
  }

  private _startOutput(): void {
    this.outputInterval = setInterval(() => {
      const axes = this.getProcessedAxes()
      this.emit('output', axes)
    }, 33) // ~30Hz
  }

  private _stopOutput(): void {
    if (this.outputInterval) {
      clearInterval(this.outputInterval)
      this.outputInterval = null
    }
  }
}
