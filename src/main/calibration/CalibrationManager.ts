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
    case CalibrationSensor.Airspeed:
      p.p6 = 1
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

/** Parse STATUSTEXT to detect calibration orientation keywords.
 * Handles both PX4 ("[cal] down orientation detected") and ArduPilot ("Place vehicle level") formats.
 */
function parseOrientation(text: string): CalibrationOrientation | null {
  const lower = text.toLowerCase()

  // PX4 format: "[cal] <side> orientation detected" or "[cal] <side> side done"
  const px4Match = lower.match(/\[cal\]\s+(down|up|front|back|left|right)\s+(orientation|side)/)
  if (px4Match) {
    switch (px4Match[1]) {
      case 'down':
        return CalibrationOrientation.Level
      case 'up':
        return CalibrationOrientation.UpsideDown
      case 'front':
        return CalibrationOrientation.NoseDown
      case 'back':
        return CalibrationOrientation.NoseUp
      case 'left':
        return CalibrationOrientation.LeftSide
      case 'right':
        return CalibrationOrientation.RightSide
    }
  }

  // ArduPilot format
  if (lower.includes('level') && !lower.includes('horizon')) return CalibrationOrientation.Level
  if (lower.includes('upside') || lower.includes('inverted'))
    return CalibrationOrientation.UpsideDown
  if (lower.includes('nose down') || lower.includes('nosedown'))
    return CalibrationOrientation.NoseDown
  if (lower.includes('nose up') || lower.includes('noseup')) return CalibrationOrientation.NoseUp
  if (lower.includes('left')) return CalibrationOrientation.LeftSide
  if (lower.includes('right')) return CalibrationOrientation.RightSide
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
    messages: [],
    progress: 0,
    currentOrientationProgress: 0,
    orientationsCompleted: [],
    currentOrientation: null
  }

  get state(): CalibrationState {
    return {
      ...this._state,
      messages: [...this._state.messages],
      orientationsCompleted: [...this._state.orientationsCompleted]
    }
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
      messages: [],
      progress: 0,
      currentOrientationProgress: 0,
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

    const lower = text.toLowerCase()
    this._state.message = text
    this._state.messages.push(text)

    // PX4: "[cal] <side> side calibration: progress <N>" — cumulative 0-100 across all sides
    const progressMatch = text.match(/progress\s*<\s*(\d+)\s*>/)
    if (progressMatch) {
      const totalPct = parseInt(progressMatch[1]!, 10) / 100 // 0..1 overall
      this._state.progress = totalPct
      this._state.status = CalibrationStatus.Collecting
      // Derive per-side progress from cumulative total
      const done = this._state.orientationsCompleted.length
      const perSide = 1 / 6
      this._state.currentOrientationProgress = Math.max(
        0,
        Math.min(1, (totalPct - done * perSide) / perSide)
      )
      this._emitState()
      return
    }

    // Check for completion — PX4: "calibration done:", ArduPilot: "calibration successful"
    if (lower.includes('calibration successful') || lower.includes('calibration done')) {
      this._state.status = CalibrationStatus.Complete
      this._state.progress = 1
      this._state.currentOrientationProgress = 0
      this._emitState()
      return
    }

    // Check for failure — PX4: "[cal] calibration failed: mag"
    if (lower.includes('calibration failed') || lower.includes('cal failed')) {
      this._state.status = CalibrationStatus.Failed
      this._emitState()
      return
    }

    // Check for cancel
    if (lower.includes('calibration cancelled') || lower.includes('calibration canceled')) {
      this._state.status = CalibrationStatus.Cancelled
      this._emitState()
      return
    }

    // PX4: "[cal] calibration started: 2 mag" or "[cal] hold vehicle still on a pending side"
    if (lower.includes('calibration started:') || lower.includes('hold vehicle still')) {
      this._state.status = CalibrationStatus.WaitingForOrientation
    }

    // PX4: "[cal] <side> orientation detected" — vehicle placed in new orientation
    if (lower.includes('orientation detected')) {
      const orientation = parseOrientation(text)
      if (orientation) {
        console.log(`[Calibration] Orientation detected: ${orientation}`)
        this._state.currentOrientation = orientation
        this._state.currentOrientationProgress = 0
        this._state.status = CalibrationStatus.Collecting
        this._state.progress = this._state.orientationsCompleted.length / 6
      }
    }

    // PX4: "[cal] <side> side done, rotate to a different side" — orientation completed
    if (lower.includes('side done')) {
      const orientation = parseOrientation(text)
      if (orientation && !this._state.orientationsCompleted.includes(orientation)) {
        this._state.orientationsCompleted.push(orientation)
        console.log(
          `[Calibration] Orientation done: ${orientation}, completed: [${this._state.orientationsCompleted}]`
        )
        this._state.currentOrientation = null
        this._state.currentOrientationProgress = 0
        this._state.status = CalibrationStatus.WaitingForOrientation
        this._state.progress = this._state.orientationsCompleted.length / 6
      }
    }

    // PX4: "[cal] side already completed" — orientation already done
    if (lower.includes('already completed')) {
      this._state.status = CalibrationStatus.WaitingForOrientation
    }

    // PX4: "[cal] detected rest position, hold still..." — detecting orientation
    if (lower.includes('detected rest position')) {
      this._state.status = CalibrationStatus.WaitingForOrientation
    }

    // PX4: "[cal] Rotate vehicle" — instruction to start rotating
    if (lower.includes('rotate vehicle')) {
      this._state.status = CalibrationStatus.Collecting
    }

    // ArduPilot: "Place vehicle..." / "Hold vehicle..." — orientation instructions
    if (lower.includes('place vehicle') || lower.includes('hold vehicle')) {
      const orientation = parseOrientation(text)
      if (orientation) {
        if (
          this._state.currentOrientation &&
          !this._state.orientationsCompleted.includes(this._state.currentOrientation)
        ) {
          this._state.orientationsCompleted.push(this._state.currentOrientation)
        }
        this._state.currentOrientation = orientation
        this._state.currentOrientationProgress = 0
        this._state.status = CalibrationStatus.WaitingForOrientation
        this._state.progress = this._state.orientationsCompleted.length / 6
      }
    }

    // Collecting data indication
    if (lower.includes('calibrating') || lower.includes('sampling')) {
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
