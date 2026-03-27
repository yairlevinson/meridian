// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { VehicleState } from '../src/main/vehicleState'

const MSG_HEARTBEAT = 0
const MSG_ATTITUDE = 30
const MSG_GLOBAL_POSITION_INT = 33
const MSG_SYS_STATUS = 1
const MSG_BATTERY_STATUS = 147
const MSG_VFR_HUD = 74

describe('VehicleState — delta encoding', () => {
  let vs: VehicleState

  beforeEach(() => {
    vs = new VehicleState()
  })

  it('only includes attitude in delta when only attitude changed', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0.05,
      yaw: 1.2,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const delta = vs.getDelta()

    expect(delta.attitude).toBeDefined()
    expect(delta.gps).toBeUndefined()
    expect(delta.core).toBeUndefined()
  })

  it('only includes gps in delta when only gps changed', () => {
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 100000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 18000
    })
    const delta = vs.getDelta()

    expect(delta.gps).toBeDefined()
    expect(delta.attitude).toBeUndefined()
    expect(delta.core).toBeUndefined()
  })

  it('only includes core in delta when only heartbeat received', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 0,
      customMode: 0,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core).toBeDefined()
    expect(delta.attitude).toBeUndefined()
    expect(delta.gps).toBeUndefined()
  })

  it('clears dirty flags after getDelta()', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    vs.getDelta()
    const delta2 = vs.getDelta()
    expect(Object.keys(delta2)).toHaveLength(0)
  })

  it('includes multiple groups when multiple messages received in one tick', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.3,
      pitch: 0.1,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 150000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 0
    })
    const delta = vs.getDelta()

    expect(delta.attitude).toBeDefined()
    expect(delta.gps).toBeDefined()
  })

  it('converts GLOBAL_POSITION_INT integer fields to float degrees and metres', () => {
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 150000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 18000
    })
    const delta = vs.getDelta()

    expect(delta.gps?.lat).toBeCloseTo(32.0, 4)
    expect(delta.gps?.lon).toBeCloseTo(34.8, 4)
    expect(delta.gps?.alt).toBeCloseTo(150, 1)
    expect(delta.gps?.hdg).toBeCloseTo(180, 1)
  })

  it('armed flag is true when SAFETY_ARMED bit set in baseMode', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 128 | 4,
      customMode: 3,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core?.armed).toBe(true)
    expect(delta.core?.flightMode).toBe(3)
  })

  it('armed flag is false when SAFETY_ARMED bit not set', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 4,
      customMode: 0,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core?.armed).toBe(false)
  })

  it('seq increments on each message of the same type', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const d1 = vs.getDelta()
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const d2 = vs.getDelta()

    expect(d2.attitude!.seq).toBe(d1.attitude!.seq + 1)
  })

  it('getDelta returns empty object when nothing changed since last call', () => {
    const delta = vs.getDelta()
    expect(Object.keys(delta)).toHaveLength(0)
  })

  // New tests for expanded message handlers
  it('handles SYS_STATUS message', () => {
    vs.handleMessage(MSG_SYS_STATUS, {
      onboardControlSensorsPresent: 0xff,
      onboardControlSensorsEnabled: 0xfe,
      onboardControlSensorsHealth: 0xfd,
      load: 500,
      dropRateComm: 10,
      errorsComm: 2,
      voltageBattery: 12000,
      currentBattery: 5000,
      batteryRemaining: 80
    })
    const delta = vs.getDelta()
    expect(delta.sysStatus).toBeDefined()
    expect(delta.sysStatus?.load).toBe(500)
    expect(delta.sysStatus?.dropRateComm).toBe(10)
  })

  it('handles BATTERY_STATUS with multiple instances', () => {
    vs.handleMessage(MSG_BATTERY_STATUS, {
      id: 0,
      voltages: [4200, 4200, 4200, 65535],
      currentBattery: 1500,
      batteryRemaining: 75,
      temperature: 3500
    })
    vs.handleMessage(MSG_BATTERY_STATUS, {
      id: 1,
      voltages: [3800, 3800, 65535],
      currentBattery: 800,
      batteryRemaining: 40,
      temperature: 4000
    })
    const delta = vs.getDelta()
    expect(delta.battery?.batteries).toHaveLength(2)
    expect(delta.battery?.batteries[0].id).toBe(0)
    expect(delta.battery?.batteries[1].id).toBe(1)
    expect(delta.battery?.batteries[0].remaining).toBe(75)
  })

  it('handles VFR_HUD message', () => {
    vs.handleMessage(MSG_VFR_HUD, {
      airspeed: 15.5,
      groundspeed: 12.3,
      heading: 270,
      throttle: 65,
      alt: 120.5,
      climb: 2.1
    })
    const delta = vs.getDelta()
    expect(delta.vfrHud).toBeDefined()
    expect(delta.vfrHud?.airspeed).toBeCloseTo(15.5)
    expect(delta.vfrHud?.groundspeed).toBeCloseTo(12.3)
    expect(delta.vfrHud?.throttle).toBe(65)
  })

  it('setSysId only marks dirty if sysid actually changes', () => {
    vs.setSysId(1)
    vs.getDelta() // clear
    vs.setSysId(1) // same value
    const delta = vs.getDelta()
    expect(delta.core).toBeUndefined()
  })

  it('setCommunicationLost updates core group', () => {
    vs.setCommunicationLost(true)
    const delta = vs.getDelta()
    expect(delta.core?.communicationLost).toBe(true)
  })
})
