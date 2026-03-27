// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CalibrationManager } from '../src/main/calibration/CalibrationManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { CalibrationSensor, CalibrationStatus, CalibrationOrientation } from '../src/shared-types/ipc/SetupTypes'

describe('CalibrationManager', () => {
  let mgr: CalibrationManager
  let link: MockLink

  beforeEach(() => {
    mgr = new CalibrationManager()
    link = new MockLink()
    mgr.setLink(link)
  })

  // --- Lifecycle ---

  it('starts in Idle state', () => {
    expect(mgr.state.status).toBe(CalibrationStatus.Idle)
    expect(mgr.isCalibrating).toBe(false)
  })

  it('transitions to Started on startCalibration', () => {
    mgr.startCalibration(CalibrationSensor.Gyro)
    expect(mgr.state.status).toBe(CalibrationStatus.Started)
    expect(mgr.state.sensor).toBe(CalibrationSensor.Gyro)
    expect(mgr.isCalibrating).toBe(true)
  })

  it('emits stateChanged on start', () => {
    const spy = vi.fn()
    mgr.on('stateChanged', spy)
    mgr.startCalibration(CalibrationSensor.Accel)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0].status).toBe(CalibrationStatus.Started)
  })

  it('sends a MAVLink COMMAND_LONG on start', () => {
    mgr.startCalibration(CalibrationSensor.Compass)
    expect(link.sentBuffers.length).toBe(1)
  })

  it('does not start if no link is set', () => {
    const noLink = new CalibrationManager()
    noLink.startCalibration(CalibrationSensor.Gyro)
    expect(noLink.state.status).toBe(CalibrationStatus.Idle)
  })

  it('does not start if already calibrating', () => {
    mgr.startCalibration(CalibrationSensor.Gyro)
    mgr.startCalibration(CalibrationSensor.Compass) // should be ignored
    expect(mgr.state.sensor).toBe(CalibrationSensor.Gyro)
    expect(link.sentBuffers.length).toBe(1)
  })

  // --- Cancel ---

  it('cancels an active calibration', () => {
    mgr.startCalibration(CalibrationSensor.Accel)
    mgr.cancelCalibration()
    expect(mgr.state.status).toBe(CalibrationStatus.Cancelled)
    expect(mgr.isCalibrating).toBe(false)
    // start + cancel = 2 buffers sent
    expect(link.sentBuffers.length).toBe(2)
  })

  it('does not cancel if not calibrating', () => {
    mgr.cancelCalibration()
    expect(mgr.state.status).toBe(CalibrationStatus.Idle)
    expect(link.sentBuffers.length).toBe(0)
  })

  // --- STATUSTEXT parsing ---

  describe('handleStatusText', () => {
    beforeEach(() => {
      mgr.startCalibration(CalibrationSensor.Accel)
    })

    it('ignores text when not calibrating', () => {
      const idle = new CalibrationManager()
      idle.setLink(link)
      idle.handleStatusText('Calibration successful', 0)
      expect(idle.state.status).toBe(CalibrationStatus.Idle)
    })

    it('detects successful calibration', () => {
      mgr.handleStatusText('Calibration successful', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Complete)
      expect(mgr.state.progress).toBe(1)
    })

    it('detects "calibration done"', () => {
      mgr.handleStatusText('Calibration Done', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Complete)
    })

    it('detects calibration failure', () => {
      mgr.handleStatusText('Calibration FAILED', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Failed)
    })

    it('detects "cal failed"', () => {
      mgr.handleStatusText('cal failed: bad data', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Failed)
    })

    it('detects cancelled (British spelling)', () => {
      mgr.handleStatusText('Calibration cancelled', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Cancelled)
    })

    it('detects canceled (American spelling)', () => {
      mgr.handleStatusText('Calibration canceled', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Cancelled)
    })

    it('detects collecting state', () => {
      mgr.handleStatusText('Calibrating sensors...', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Collecting)
    })

    it('detects sampling state', () => {
      mgr.handleStatusText('Sampling data', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Collecting)
    })

    it('stores the last message text', () => {
      mgr.handleStatusText('Some progress info', 0)
      expect(mgr.state.message).toBe('Some progress info')
    })

    // --- Orientation detection ---

    it('detects "Place vehicle level" orientation', () => {
      mgr.handleStatusText('Place vehicle level', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.WaitingForOrientation)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.Level)
    })

    it('detects "Place vehicle nose down" orientation', () => {
      mgr.handleStatusText('Place vehicle nose down', 0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.NoseDown)
    })

    it('detects "Place vehicle upside down" orientation', () => {
      mgr.handleStatusText('Place vehicle upside down', 0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.UpsideDown)
    })

    it('detects "hold vehicle" with left side', () => {
      mgr.handleStatusText('Hold vehicle on left side', 0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.LeftSide)
    })

    it('detects right side orientation', () => {
      mgr.handleStatusText('Place vehicle on right side', 0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.RightSide)
    })

    it('detects nose up orientation', () => {
      mgr.handleStatusText('Place vehicle nose up', 0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.NoseUp)
    })

    it('tracks completed orientations as new ones are requested', () => {
      mgr.handleStatusText('Place vehicle level', 0)
      expect(mgr.state.orientationsCompleted).toHaveLength(0)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.Level)

      mgr.handleStatusText('Place vehicle nose down', 0)
      expect(mgr.state.orientationsCompleted).toContain(CalibrationOrientation.Level)
      expect(mgr.state.currentOrientation).toBe(CalibrationOrientation.NoseDown)
    })

    it('updates progress based on completed orientations (6 total)', () => {
      mgr.handleStatusText('Place vehicle level', 0)
      expect(mgr.state.progress).toBe(0) // 0/6

      mgr.handleStatusText('Place vehicle nose down', 0)
      expect(mgr.state.progress).toBeCloseTo(1 / 6) // 1/6

      mgr.handleStatusText('Place vehicle nose up', 0)
      expect(mgr.state.progress).toBeCloseTo(2 / 6) // 2/6
    })
  })

  // --- COMMAND_ACK ---

  describe('handleCommandAck', () => {
    it('ignores non-241 commands', () => {
      mgr.startCalibration(CalibrationSensor.Gyro)
      mgr.handleCommandAck(22, 4) // some other command
      expect(mgr.state.status).toBe(CalibrationStatus.Started)
    })

    it('ignores ACK when not calibrating', () => {
      mgr.handleCommandAck(241, 4)
      expect(mgr.state.status).toBe(CalibrationStatus.Idle)
    })

    it('transitions to Failed on FAILED result (4)', () => {
      mgr.startCalibration(CalibrationSensor.Gyro)
      mgr.handleCommandAck(241, 4)
      expect(mgr.state.status).toBe(CalibrationStatus.Failed)
      expect(mgr.state.message).toBe('Calibration command rejected')
    })

    it('keeps calibrating on ACCEPTED (0)', () => {
      mgr.startCalibration(CalibrationSensor.Gyro)
      mgr.handleCommandAck(241, 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Started)
    })

    it('keeps calibrating on IN_PROGRESS (5)', () => {
      mgr.startCalibration(CalibrationSensor.Gyro)
      mgr.handleCommandAck(241, 5)
      expect(mgr.state.status).toBe(CalibrationStatus.Started)
    })
  })

  // --- MAG_CAL_PROGRESS ---

  describe('handleMagCalProgress', () => {
    it('emits magProgress and updates state', () => {
      mgr.startCalibration(CalibrationSensor.Compass)
      const spy = vi.fn()
      mgr.on('magProgress', spy)

      mgr.handleMagCalProgress({
        compassId: 0,
        calMask: 1,
        calStatus: 2,
        attempt: 0,
        completionPct: 42,
        completionMask: [],
        directionX: 0.5,
        directionY: 0.3,
        directionZ: 0.1
      })

      expect(mgr.state.progress).toBeCloseTo(0.42)
      expect(mgr.state.status).toBe(CalibrationStatus.Collecting)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0][0].compassId).toBe(0)
      expect(spy.mock.calls[0][0].completionPct).toBe(42)
    })
  })

  // --- MAG_CAL_REPORT ---

  describe('handleMagCalReport', () => {
    beforeEach(() => {
      mgr.startCalibration(CalibrationSensor.Compass)
    })

    it('emits magReport', () => {
      const spy = vi.fn()
      mgr.on('magReport', spy)

      mgr.handleMagCalReport({
        compassId: 0,
        calMask: 1,
        calStatus: 4,
        autosaved: 1,
        fitness: 0.015,
        ofsX: 10,
        ofsY: 20,
        ofsZ: 30
      })

      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0][0].fitness).toBe(0.015)
    })

    it('completes on calStatus=4 (SUCCESS)', () => {
      mgr.handleMagCalReport({
        compassId: 0,
        calMask: 1,
        calStatus: 4,
        autosaved: 1,
        fitness: 0.01,
        ofsX: 0,
        ofsY: 0,
        ofsZ: 0
      })

      expect(mgr.state.status).toBe(CalibrationStatus.Complete)
      expect(mgr.state.progress).toBe(1)
      expect(mgr.state.message).toContain('fitness: 0.010')
    })

    it('fails on calStatus=5 (FAILED)', () => {
      mgr.handleMagCalReport({
        compassId: 0,
        calMask: 1,
        calStatus: 5,
        autosaved: 0,
        fitness: 99,
        ofsX: 0,
        ofsY: 0,
        ofsZ: 0
      })

      expect(mgr.state.status).toBe(CalibrationStatus.Failed)
      expect(mgr.state.message).toBe('Compass calibration failed')
    })

    it('ignores non-terminal calStatus values', () => {
      mgr.handleMagCalReport({
        compassId: 0,
        calMask: 1,
        calStatus: 2, // RUNNING_STEP_ONE
        autosaved: 0,
        fitness: 0,
        ofsX: 0,
        ofsY: 0,
        ofsZ: 0
      })

      // Still collecting from the earlier startCalibration
      expect(mgr.state.status).toBe(CalibrationStatus.Started)
    })
  })

  // --- state returns a copy ---

  it('returns a defensive copy of state', () => {
    mgr.startCalibration(CalibrationSensor.Accel)
    const s1 = mgr.state
    const s2 = mgr.state
    expect(s1).not.toBe(s2)
    expect(s1).toEqual(s2)
  })

  // --- ESC calibration ---

  describe('ESC calibration', () => {
    it('starts ESC calibration', () => {
      mgr.startCalibration(CalibrationSensor.Esc)
      expect(mgr.state.status).toBe(CalibrationStatus.Started)
      expect(mgr.state.sensor).toBe(CalibrationSensor.Esc)
      expect(link.sentBuffers.length).toBe(1)
    })

    it('completes ESC calibration via STATUSTEXT', () => {
      mgr.startCalibration(CalibrationSensor.Esc)
      mgr.handleStatusText('Calibration successful', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Complete)
    })

    it('handles ESC calibration failure', () => {
      mgr.startCalibration(CalibrationSensor.Esc)
      mgr.handleStatusText('Calibration FAILED', 0)
      expect(mgr.state.status).toBe(CalibrationStatus.Failed)
    })
  })

  // --- destroy ---

  it('removes all listeners on destroy', () => {
    const spy = vi.fn()
    mgr.on('stateChanged', spy)
    mgr.destroy()
    mgr.startCalibration(CalibrationSensor.Gyro)
    expect(spy).not.toHaveBeenCalled()
  })
})
