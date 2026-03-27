// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import { CalibrationStatus, CalibrationSensor } from '../src/shared-types/ipc/SetupTypes'

/**
 * Tests that Vehicle.handleMessage correctly routes setup-related
 * MAVLink messages to the appropriate managers.
 */
describe('Vehicle setup message routing', () => {
  let vehicle: Vehicle

  beforeEach(() => {
    vehicle = new Vehicle(1)
  })

  function sendMessage(msgid: number, data: Record<string, unknown>) {
    vehicle.handleMessage({ msgid, sysid: 1, compid: 1, seq: 0, data }, 'link-0')
  }

  // --- PARAM_VALUE (22) -> ParameterManager ---

  it('routes PARAM_VALUE (22) to parameterManager', () => {
    const spy = vi.spyOn(vehicle.parameterManager, 'handleParamValue')

    sendMessage(22, {
      paramId: 'BATT_CAPACITY',
      paramValue: 3300,
      paramType: 9,
      paramCount: 100,
      paramIndex: 5
    })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toMatchObject({
      paramId: 'BATT_CAPACITY',
      paramValue: 3300
    })
  })

  // --- COMMAND_ACK (77) -> CalibrationManager ---

  it('routes COMMAND_ACK (77) to calibrationManager', () => {
    const spy = vi.spyOn(vehicle.calibrationManager, 'handleCommandAck')

    sendMessage(77, { command: 241, result: 0 })

    expect(spy).toHaveBeenCalledWith(241, 0)
  })

  it('routes COMMAND_ACK (77) to both commandQueue and calibrationManager', () => {
    const cmdSpy = vi.spyOn(vehicle.commandQueue, 'handleCommandAck')
    const calSpy = vi.spyOn(vehicle.calibrationManager, 'handleCommandAck')

    sendMessage(77, { command: 241, result: 4 })

    expect(cmdSpy).toHaveBeenCalledOnce()
    expect(calSpy).toHaveBeenCalledWith(241, 4)
  })

  // --- STATUSTEXT (253) -> CalibrationManager + event ---

  it('routes STATUSTEXT (253) to calibrationManager', () => {
    const spy = vi.spyOn(vehicle.calibrationManager, 'handleStatusText')

    sendMessage(253, { severity: 6, text: 'Calibration successful\0\0\0' })

    expect(spy).toHaveBeenCalledWith('Calibration successful', 6)
  })

  it('emits statusText event with null bytes stripped', () => {
    const spy = vi.fn()
    vehicle.on('statusText', spy)

    sendMessage(253, { severity: 4, text: 'Motor test\0\0\0\0' })

    expect(spy).toHaveBeenCalledWith({ severity: 4, text: 'Motor test' })
  })

  // --- MAG_CAL_PROGRESS (191) -> CalibrationManager ---

  it('routes MAG_CAL_PROGRESS (191) to calibrationManager', () => {
    const spy = vi.spyOn(vehicle.calibrationManager, 'handleMagCalProgress')

    sendMessage(191, {
      compassId: 0,
      calMask: 1,
      calStatus: 2,
      attempt: 0,
      completionPct: 55,
      completionMask: [],
      directionX: 0.1,
      directionY: 0.2,
      directionZ: 0.3
    })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toMatchObject({ compassId: 0, completionPct: 55 })
  })

  // --- MAG_CAL_REPORT (192) -> CalibrationManager ---

  it('routes MAG_CAL_REPORT (192) to calibrationManager', () => {
    const spy = vi.spyOn(vehicle.calibrationManager, 'handleMagCalReport')

    sendMessage(192, {
      compassId: 0,
      calMask: 1,
      calStatus: 4,
      autosaved: 1,
      fitness: 0.01,
      ofsX: 10,
      ofsY: 20,
      ofsZ: 30
    })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toMatchObject({ calStatus: 4, fitness: 0.01 })
  })

  // --- RC_CHANNELS (65) -> RcCalibrationManager ---

  it('routes RC_CHANNELS (65) to rcCalibrationManager', () => {
    const spy = vi.spyOn(vehicle.rcCalibrationManager, 'updateChannels')

    sendMessage(65, {
      chancount: 4,
      chan1Raw: 1500,
      chan2Raw: 1500,
      chan3Raw: 1000,
      chan4Raw: 1500,
      chan5Raw: 0,
      chan6Raw: 0,
      chan7Raw: 0,
      chan8Raw: 0,
      chan9Raw: 0,
      chan10Raw: 0,
      chan11Raw: 0,
      chan12Raw: 0,
      chan13Raw: 0,
      chan14Raw: 0,
      chan15Raw: 0,
      chan16Raw: 0,
      chan17Raw: 0,
      chan18Raw: 0
    })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toEqual([
      1500, 1500, 1000, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ])
    expect(spy.mock.calls[0][1]).toBe(4)
  })

  // --- Auto parameter request on first heartbeat ---

  it('auto-requests parameters after first heartbeat', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(vehicle.parameterManager, 'requestAllParameters')

    sendMessage(0, {
      type: 2,
      autopilot: 3,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4
    })

    expect(spy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledOnce()

    // Second heartbeat should NOT trigger another request
    sendMessage(0, {
      type: 2,
      autopilot: 3,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4
    })
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledOnce() // still just once

    vi.useRealTimers()
  })
})
