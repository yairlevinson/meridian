import { EventEmitter } from 'events'
import type { LinkInterface } from '../links/LinkInterface'
import { createGcsProtocol } from '../mavlink/constants'
import {
  CalibrationSensor,
  CalibrationStatus,
  CalibrationOrientation,
  type CalibrationState,
  type MagCalProgress,
  type MagCalReport
} from '@shared/ipc/SetupTypes'
import { common } from 'mavlink-mappings'

/** Maps CalibrationSensor to MAV_CMD_PREFLIGHT_CALIBRATION params */
function calibrationParams(sensor: CalibrationSensor): {
  p1: number
  p2: number
  p3: number
  p4: number
  p5: number
  p6: number
  p7: number
} {
  const p = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0 }
  switch (sensor) {
    case CalibrationSensor.Gyro:
      p.p1 = 1
      break
    case CalibrationSensor.Compass:
      p.p2 = 1
      break
    case CalibrationSensor.Pressure:
      p.p3 = 1
      break
    case CalibrationSensor.Accel:
      p.p5 = 1
      break
    case CalibrationSensor.LevelHorizon:
      p.p5 = 2
      break
    case CalibrationSensor.AccelSimple:
      p.p5 = 4
      break
    case CalibrationSensor.CompassMot:
      p.p6 = 1
      break
    case CalibrationSensor.Esc:
      p.p7 = 1
      break
  }
  return p
}

/** Parse STATUSTEXT to detect calibration orientation keywords */
function parseOrientation(text: string): CalibrationOrientation | null {
  const lower = text.toLowerCase()
  if (lower.includes('level') && !lower.includes('horizon')) return CalibrationOrientation.Level
  if (lower.includes('upside') || lower.includes('inverted'))
    return CalibrationOrientation.UpsideDown
  if (lower.includes('nose down') || lower.includes('nosedown'))
    return CalibrationOrientation.NoseDown
  if (lower.includes('nose up') || lower.includes('noseup')) return CalibrationOrientation.NoseUp
  if (lower.includes('left')) return CalibrationOrientation.LeftSide
  if (lower.includes('right')) return CalibrationOrientation.RightSide
  // "level" in the context of level horizon calibration
  if (lower.includes('level')) return CalibrationOrientation.Level
  return null
}

/**
 * Manages sensor calibration via MAV_CMD_PREFLIGHT_CALIBRATION (241).
 * Progress is communicated via STATUSTEXT parsing + MAG_CAL_PROGRESS/REPORT.
 */
export class CalibrationManager extends EventEmitter {
  private link: LinkInterface | null = null
  private protocol = createGcsProtocol()
  private seq = 0
  private targetSystem = 1
  private _state: CalibrationState = {
    sensor: CalibrationSensor.Gyro,
    status: CalibrationStatus.Idle,
    message: '',
    progress: 0,
    orientationsCompleted: [],
    currentOrientation: null
  }

  get state(): CalibrationState {
    return { ...this._state }
  }

  get isCalibrating(): boolean {
    return (
      this._state.status !== CalibrationStatus.Idle &&
      this._state.status !== CalibrationStatus.Complete &&
      this._state.status !== CalibrationStatus.Failed &&
      this._state.status !== CalibrationStatus.Cancelled
    )
  }

  setLink(link: LinkInterface): void {
    this.link = link
  }

  setTarget(sysid: number): void {
    this.targetSystem = sysid
  }

  /** Start a sensor calibration */
  startCalibration(sensor: CalibrationSensor): void {
    if (!this.link) return
    if (this.isCalibrating) return

    this._state = {
      sensor,
      status: CalibrationStatus.Started,
      message: `Starting ${sensor} calibration...`,
      progress: 0,
      orientationsCompleted: [],
      currentOrientation: null
    }
    this._emitState()

    const params = calibrationParams(sensor)
    const cmd = new common.CommandLong()
    cmd.targetSystem = this.targetSystem
    cmd.targetComponent = 1
    cmd.command = 241 // MAV_CMD_PREFLIGHT_CALIBRATION
    cmd.confirmation = 0
    cmd._param1 = params.p1
    cmd._param2 = params.p2
    cmd._param3 = params.p3
    cmd._param4 = params.p4
    cmd._param5 = params.p5
    cmd._param6 = params.p6
    cmd._param7 = params.p7

    const buf = this.protocol.serialize(cmd, this.seq++ & 0xff)
    this.link.writeBytes(buf)
  }

  /** Cancel the current calibration */
  cancelCalibration(): void {
    if (!this.link) return
    if (!this.isCalibrating) return

    // Send calibration command with all zeros to cancel
    const cmd = new common.CommandLong()
    cmd.targetSystem = this.targetSystem
    cmd.targetComponent = 1
    cmd.command = 241
    cmd.confirmation = 0
    cmd._param1 = 0
    cmd._param2 = 0
    cmd._param3 = 0
    cmd._param4 = 0
    cmd._param5 = 0
    cmd._param6 = 0
    cmd._param7 = 0

    const buf = this.protocol.serialize(cmd, this.seq++ & 0xff)
    this.link.writeBytes(buf)

    this._state.status = CalibrationStatus.Cancelled
    this._state.message = 'Calibration cancelled'
    this._emitState()
  }

  /** Handle STATUSTEXT from the vehicle — main calibration feedback channel */
  handleStatusText(text: string, _severity: number): void {
    if (!this.isCalibrating) return

    this._state.message = text

    // Check for completion
    if (text.toLowerCase().includes('calibration successful') || text.toLowerCase().includes('calibration done')) {
      this._state.status = CalibrationStatus.Complete
      this._state.progress = 1
      this._emitState()
      return
    }

    // Check for failure
    if (text.toLowerCase().includes('calibration failed') || text.toLowerCase().includes('cal failed')) {
      this._state.status = CalibrationStatus.Failed
      this._emitState()
      return
    }

    // Check for cancel
    if (text.toLowerCase().includes('calibration cancelled') || text.toLowerCase().includes('calibration canceled')) {
      this._state.status = CalibrationStatus.Cancelled
      this._emitState()
      return
    }

    // Check for orientation instructions (accel 6-side calibration)
    if (text.toLowerCase().includes('place vehicle') || text.toLowerCase().includes('hold vehicle')) {
      const orientation = parseOrientation(text)
      if (orientation) {
        // If we were waiting on a previous orientation, mark it done
        if (
          this._state.currentOrientation &&
          !this._state.orientationsCompleted.includes(this._state.currentOrientation)
        ) {
          this._state.orientationsCompleted.push(this._state.currentOrientation)
        }
        this._state.currentOrientation = orientation
        this._state.status = CalibrationStatus.WaitingForOrientation
        this._state.progress = this._state.orientationsCompleted.length / 6
      }
    }

    // Collecting data indication
    if (text.toLowerCase().includes('calibrating') || text.toLowerCase().includes('sampling')) {
      this._state.status = CalibrationStatus.Collecting
    }

    this._emitState()
  }

  /** Handle COMMAND_ACK for MAV_CMD_PREFLIGHT_CALIBRATION */
  handleCommandAck(command: number, result: number): void {
    if (command !== 241) return
    if (!this.isCalibrating) return

    // MAV_RESULT values: 0=ACCEPTED, 1=TEMPORARILY_REJECTED, 2=DENIED,
    // 3=UNSUPPORTED, 4=FAILED, 5=IN_PROGRESS
    if (result === 4) {
      // FAILED
      this._state.status = CalibrationStatus.Failed
      this._state.message = 'Calibration command rejected'
      this._emitState()
    }
    // IN_PROGRESS (5) and ACCEPTED (0) are normal — calibration continues
  }

  /** Handle MAG_CAL_PROGRESS (msgid 191) */
  handleMagCalProgress(data: {
    compassId: number
    calMask: number
    calStatus: number
    attempt: number
    completionPct: number
    completionMask: number[]
    directionX: number
    directionY: number
    directionZ: number
  }): void {
    const progress: MagCalProgress = {
      compassId: data.compassId,
      completionPct: data.completionPct,
      directionX: data.directionX,
      directionY: data.directionY,
      directionZ: data.directionZ
    }
    this._state.progress = data.completionPct / 100
    this._state.status = CalibrationStatus.Collecting
    this.emit('magProgress', progress)
    this._emitState()
  }

  /** Handle MAG_CAL_REPORT (msgid 192) */
  handleMagCalReport(data: {
    compassId: number
    calMask: number
    calStatus: number
    autosaved: number
    fitness: number
    ofsX: number
    ofsY: number
    ofsZ: number
  }): void {
    const report: MagCalReport = {
      compassId: data.compassId,
      calStatus: data.calStatus,
      fitness: data.fitness,
      ofsX: data.ofsX,
      ofsY: data.ofsY,
      ofsZ: data.ofsZ
    }
    this.emit('magReport', report)

    // calStatus: 0=NOT_STARTED, 1=WAITING, 2=RUNNING_STEP_ONE, 3=RUNNING_STEP_TWO, 4=SUCCESS, 5=FAILED
    if (data.calStatus === 4) {
      this._state.status = CalibrationStatus.Complete
      this._state.progress = 1
      this._state.message = `Compass calibration complete (fitness: ${data.fitness.toFixed(3)})`
      this._emitState()
    } else if (data.calStatus === 5) {
      this._state.status = CalibrationStatus.Failed
      this._state.message = 'Compass calibration failed'
      this._emitState()
    }
  }

  destroy(): void {
    this.removeAllListeners()
  }

  private _emitState(): void {
    this.emit('stateChanged', this.state)
  }
}
