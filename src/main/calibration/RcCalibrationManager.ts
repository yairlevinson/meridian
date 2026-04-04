import { EventEmitter } from 'events'
import { RcCalStep, type RcCalibrationState, type RcCalibrationChannelData } from '@shared/ipc/SetupTypes'
import type { ParameterManager } from '../parameters/ParameterManager'

const MAX_CHANNELS = 16
const DEFAULT_TRIM = 1500
const STICK_DETECT_THRESHOLD = 100 // PWM delta from trim to detect a stick
const MAV_AUTOPILOT_PX4 = 12

/**
 * State machine for RC transmitter calibration.
 * Reads live RC channel values from VehicleState and writes
 * the correct parameters for PX4 or ArduPilot on save.
 *
 * PX4:      RC_MAP_ROLL/PITCH/YAW/THROTTLE, RC#_MIN/MAX/TRIM, RC#_REV (float ±1.0), RC_CHAN_CNT
 * ArduPilot: RCMAP_ROLL/PITCH/YAW/THROTTLE, RC#_MIN/MAX/TRIM, RC#_REVERSED (0/1)
 */
export class RcCalibrationManager extends EventEmitter {
  private _step = RcCalStep.Idle
  private _channelCount = 0
  private _channels: Map<number, RcCalibrationChannelData> = new Map()
  private _stickMapping: Record<string, number | null> = {
    Roll: null,
    Pitch: null,
    Yaw: null,
    Throttle: null
  }
  private _trimValues: number[] = []
  private _currentStick = ''
  private _autopilotType = 0
  private parameterManager: ParameterManager | null = null

  get isPX4(): boolean {
    return this._autopilotType === MAV_AUTOPILOT_PX4
  }

  get state(): RcCalibrationState {
    const channels: Record<number, RcCalibrationChannelData> = {}
    for (const [i, data] of this._channels) {
      channels[i] = { ...data }
    }
    return {
      step: this._step,
      channels,
      channelCount: this._channelCount,
      stickMapping: { ...this._stickMapping },
      currentStick: this._currentStick || undefined
    }
  }

  setParameterManager(pm: ParameterManager): void {
    this.parameterManager = pm
  }

  setAutopilotType(autopilot: number): void {
    this._autopilotType = autopilot
  }

  /** Start calibration — user should center all sticks */
  start(): void {
    this._step = RcCalStep.Center
    this._channels.clear()
    this._stickMapping = { Roll: null, Pitch: null, Yaw: null, Throttle: null }
    this._trimValues = []
    this._currentStick = ''
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
        this._currentStick = 'Roll'
        break

      case RcCalStep.DetectSticks: {
        // Move to next stick or advance to MinMax
        const stickOrder = ['Roll', 'Pitch', 'Yaw', 'Throttle']
        const nextIdx = stickOrder.indexOf(this._currentStick) + 1
        if (nextIdx < stickOrder.length) {
          this._currentStick = stickOrder[nextIdx]!
        } else {
          this._currentStick = ''
          this._step = RcCalStep.MinMax
        }
        break
      }

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
    this._currentStick = ''
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

        const trim = ch.trim
        const range = ch.max - ch.min
        if (range > STICK_DETECT_THRESHOLD * 2) {
          const stickForChannel = Object.entries(this._stickMapping).find(([, chIdx]) => chIdx === i)
          if (stickForChannel) {
            const stick = stickForChannel[0]
            const maxAbove = ch.max - trim
            const maxBelow = trim - ch.min
            if (stick === 'Throttle') {
              ch.reversed = maxBelow > maxAbove && maxBelow > STICK_DETECT_THRESHOLD
            } else {
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
      const idx = i + 1 // params are 1-indexed
      this.parameterManager.setParameter(`RC${idx}_MIN`, ch.min)
      this.parameterManager.setParameter(`RC${idx}_MAX`, ch.max)
      this.parameterManager.setParameter(`RC${idx}_TRIM`, ch.trim)

      if (this.isPX4) {
        // PX4: RC#_REV is a float (-1.0 = reversed, 1.0 = normal)
        this.parameterManager.setParameter(`RC${idx}_REV`, ch.reversed ? -1.0 : 1.0)
      } else {
        // ArduPilot: RC#_REVERSED is a boolean (0/1)
        this.parameterManager.setParameter(`RC${idx}_REVERSED`, ch.reversed ? 1 : 0)
      }
    }

    // Write stick-to-channel mappings (1-indexed channels)
    const rollCh = this._stickMapping.Roll
    const pitchCh = this._stickMapping.Pitch
    const yawCh = this._stickMapping.Yaw
    const throttleCh = this._stickMapping.Throttle

    if (this.isPX4) {
      // PX4: RC_MAP_* params
      if (rollCh != null) this.parameterManager.setParameter('RC_MAP_ROLL', rollCh + 1)
      if (pitchCh != null) this.parameterManager.setParameter('RC_MAP_PITCH', pitchCh + 1)
      if (yawCh != null) this.parameterManager.setParameter('RC_MAP_YAW', yawCh + 1)
      if (throttleCh != null) this.parameterManager.setParameter('RC_MAP_THROTTLE', throttleCh + 1)
      // PX4: write detected channel count
      this.parameterManager.setParameter('RC_CHAN_CNT', this._channelCount)
    } else {
      // ArduPilot: RCMAP_* params
      if (rollCh != null) this.parameterManager.setParameter('RCMAP_ROLL', rollCh + 1)
      if (pitchCh != null) this.parameterManager.setParameter('RCMAP_PITCH', pitchCh + 1)
      if (yawCh != null) this.parameterManager.setParameter('RCMAP_YAW', yawCh + 1)
      if (throttleCh != null) this.parameterManager.setParameter('RCMAP_THROTTLE', throttleCh + 1)
    }

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
