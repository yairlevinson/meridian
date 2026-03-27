import { EventEmitter } from 'events'
import { RcCalStep, type RcCalibrationState, type RcCalibrationChannelData } from '@shared/ipc/SetupTypes'
import type { ParameterManager } from '../parameters/ParameterManager'

const MAX_CHANNELS = 16
const DEFAULT_TRIM = 1500
const STICK_DETECT_THRESHOLD = 100 // PWM delta from trim to detect a stick

/**
 * State machine for RC transmitter calibration.
 * Reads live RC channel values from VehicleState and writes
 * RC*_MIN/MAX/TRIM/REVERSED + RCMAP_* parameters on save.
 */
export class RcCalibrationManager extends EventEmitter {
  private _step = RcCalStep.Idle
  private _channelCount = 0
  private _channels: Map<number, RcCalibrationChannelData> = new Map()
  private _stickMapping: Record<string, number | null> = {
    roll: null,
    pitch: null,
    yaw: null,
    throttle: null
  }
  private _trimValues: number[] = []
  private _currentStick = ''
  private parameterManager: ParameterManager | null = null

  get state(): RcCalibrationState {
    const channels: Record<number, RcCalibrationChannelData> = {}
    for (const [i, data] of this._channels) {
      channels[i] = { ...data }
    }
    return {
      step: this._step,
      channels,
      channelCount: this._channelCount,
      stickMapping: { ...this._stickMapping }
    }
  }

  setParameterManager(pm: ParameterManager): void {
    this.parameterManager = pm
  }

  /** Start calibration — user should center all sticks */
  start(): void {
    this._step = RcCalStep.Center
    this._channels.clear()
    this._stickMapping = { roll: null, pitch: null, yaw: null, throttle: null }
    this._trimValues = []
    this._emitState()
  }

  /** Advance to the next calibration step */
  nextStep(): void {
    switch (this._step) {
      case RcCalStep.Center:
        // Record trim values from current channel data
        this._trimValues = []
        for (let i = 0; i < this._channelCount; i++) {
          const ch = this._channels.get(i)
          this._trimValues[i] = ch?.currentValue ?? DEFAULT_TRIM
        }
        // Initialize channel data with trims
        for (let i = 0; i < this._channelCount; i++) {
          const trim = this._trimValues[i] ?? DEFAULT_TRIM
          this._channels.set(i, {
            min: trim,
            max: trim,
            trim,
            reversed: false,
            currentValue: trim
          })
        }
        this._step = RcCalStep.DetectSticks
        this._currentStick = 'roll'
        break

      case RcCalStep.DetectSticks:
        // Move to next stick or advance to MinMax
        const stickOrder = ['roll', 'pitch', 'yaw', 'throttle']
        const nextIdx = stickOrder.indexOf(this._currentStick) + 1
        if (nextIdx < stickOrder.length) {
          this._currentStick = stickOrder[nextIdx]!
        } else {
          this._step = RcCalStep.MinMax
        }
        break

      case RcCalStep.MinMax:
        this._step = RcCalStep.Complete
        break

      default:
        break
    }
    this._emitState()
  }

  /** Cancel calibration */
  cancel(): void {
    this._step = RcCalStep.Idle
    this._channels.clear()
    this._emitState()
  }

  /** Update with live RC channel values (called at 30Hz from VehicleState) */
  updateChannels(channels: number[], channelCount: number): void {
    this._channelCount = channelCount

    for (let i = 0; i < channelCount && i < MAX_CHANNELS; i++) {
      const value = channels[i] ?? 0
      let ch = this._channels.get(i)

      if (!ch) {
        ch = {
          min: value,
          max: value,
          trim: DEFAULT_TRIM,
          reversed: false,
          currentValue: value
        }
        this._channels.set(i, ch)
      } else {
        ch.currentValue = value
      }

      // During MinMax step, track extremes and detect reversal
      if (this._step === RcCalStep.MinMax) {
        if (value < ch.min) ch.min = value
        if (value > ch.max) ch.max = value

        // Detect reversal: for mapped stick channels, if the stick moves
        // opposite to expected direction (min side when expecting max), mark reversed.
        // A channel is reversed if the first large deflection from trim goes
        // toward a lower PWM value for roll/pitch/yaw, or toward higher for throttle.
        const trim = ch.trim
        const range = ch.max - ch.min
        if (range > STICK_DETECT_THRESHOLD * 2) {
          const stickForChannel = Object.entries(this._stickMapping).find(([, chIdx]) => chIdx === i)
          if (stickForChannel) {
            const stick = stickForChannel[0]
            // Throttle: normal = low PWM at bottom, high PWM at top
            // Roll/Pitch/Yaw: normal = low PWM = left/down, high PWM = right/up
            // Reversed if the max deflection is on the wrong side of trim
            const maxAbove = ch.max - trim
            const maxBelow = trim - ch.min
            if (stick === 'throttle') {
              // Throttle reversed if min is closer to center than max below
              ch.reversed = maxBelow > maxAbove && maxBelow > STICK_DETECT_THRESHOLD
            } else {
              // Roll/Pitch/Yaw reversed if more range below trim than above
              ch.reversed = maxBelow > maxAbove && maxBelow > STICK_DETECT_THRESHOLD
            }
          }
        }
      }

      // During DetectSticks, detect which channel has the largest deflection
      if (this._step === RcCalStep.DetectSticks && this._currentStick) {
        const trim = this._trimValues[i] ?? DEFAULT_TRIM
        const delta = Math.abs(value - trim)
        if (delta > STICK_DETECT_THRESHOLD) {
          // Check this channel isn't already mapped
          const alreadyMapped = Object.values(this._stickMapping).includes(i)
          if (!alreadyMapped) {
            this._stickMapping[this._currentStick] = i
          }
        }
      }
    }

    // Emit state periodically during active calibration (throttled by caller)
    if (this._step !== RcCalStep.Idle) {
      this._emitState()
    }
  }

  /** Save calibration results as parameters */
  async save(): Promise<void> {
    if (!this.parameterManager) return
    if (this._step !== RcCalStep.Complete) return

    for (const [i, ch] of this._channels) {
      const idx = i + 1 // ArduPilot params are 1-indexed
      this.parameterManager.setParameter(`RC${idx}_MIN`, ch.min)
      this.parameterManager.setParameter(`RC${idx}_MAX`, ch.max)
      this.parameterManager.setParameter(`RC${idx}_TRIM`, ch.trim)
      this.parameterManager.setParameter(`RC${idx}_REVERSED`, ch.reversed ? 1 : 0)
    }

    // Write stick-to-channel mappings (RCMAP uses 1-indexed channels)
    const rollCh = this._stickMapping.roll
    const pitchCh = this._stickMapping.pitch
    const yawCh = this._stickMapping.yaw
    const throttleCh = this._stickMapping.throttle
    if (rollCh != null) this.parameterManager.setParameter('RCMAP_ROLL', rollCh + 1)
    if (pitchCh != null) this.parameterManager.setParameter('RCMAP_PITCH', pitchCh + 1)
    if (yawCh != null) this.parameterManager.setParameter('RCMAP_YAW', yawCh + 1)
    if (throttleCh != null) this.parameterManager.setParameter('RCMAP_THROTTLE', throttleCh + 1)

    this._step = RcCalStep.Idle
    this._emitState()
  }

  destroy(): void {
    this.removeAllListeners()
  }

  private _emitState(): void {
    this.emit('stateChanged', this.state)
  }
}
