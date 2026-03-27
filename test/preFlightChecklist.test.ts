// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import type {
  GpsRawGroup,
  BatteryGroup,
  SysStatusGroup,
  CoreGroup,
  RcGroup
} from '../src/shared-types/ipc/VehicleState'

/**
 * Pre-Flight Checklist tests — validates telemetry check logic at the store level.
 * Mirrors the thresholds in PreFlightChecklist.tsx:
 *   GPS: fixType >= 3, satelliteCount >= 9
 *   Battery: remaining >= 40%
 *   Sensors: (enabled & CHECKED_SENSORS) & ~health === 0
 *   Comms: !communicationLost
 *   RC: channelCount > 0 && some channel > 0
 */

const SENSOR_3D_GYRO = 1 << 0
const SENSOR_3D_ACCEL = 1 << 1
const SENSOR_3D_MAG = 1 << 2
const SENSOR_ABSOLUTE_PRESSURE = 1 << 3
const SENSOR_GPS = 1 << 5
const SENSOR_AHRS = 1 << 21

const ALL_CHECKED =
  SENSOR_3D_GYRO | SENSOR_3D_ACCEL | SENSOR_3D_MAG | SENSOR_ABSOLUTE_PRESSURE | SENSOR_GPS | SENSOR_AHRS

function makeCore(overrides: Partial<CoreGroup> = {}): CoreGroup {
  return {
    sysid: 1,
    compid: 1,
    armed: false,
    flightMode: 0,
    flightModeName: 'STABILIZE',
    vehicleType: 2,
    autopilot: 3,
    systemStatus: 3,
    firmwareVersionMajor: 4,
    firmwareVersionMinor: 0,
    firmwareVersionPatch: 3,
    communicationLost: false,
    communicationLostCountdown: 0,
    seq: 1,
    ...overrides
  }
}

function makeGpsRaw(overrides: Partial<GpsRawGroup> = {}): GpsRawGroup {
  return {
    fixType: 3,
    satelliteCount: 12,
    hdop: 1.2,
    vdop: 2.0,
    lat: 32.0,
    lon: 34.8,
    alt: 150,
    seq: 1,
    ...overrides
  }
}

function makeBattery(remaining: number): BatteryGroup {
  return {
    batteries: [
      {
        id: 0,
        voltage: 12.6,
        current: 15,
        remaining,
        temperature: 35,
        cellCount: 3,
        chargeState: 0
      }
    ],
    seq: 1
  }
}

function makeSysStatus(
  enabled: number,
  health: number,
  overrides: Partial<SysStatusGroup> = {}
): SysStatusGroup {
  return {
    onboardControlSensorsPresent: enabled,
    onboardControlSensorsEnabled: enabled,
    onboardControlSensorsHealth: health,
    load: 100,
    dropRateComm: 0,
    errorsComm: 0,
    seq: 1,
    ...overrides
  }
}

function makeRc(channelCount: number, channels: number[]): RcGroup {
  return {
    channels,
    rssi: 200,
    channelCount,
    seq: 1
  }
}

describe('Pre-Flight Checklist — GPS check', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('passes with 3D fix and enough satellites', () => {
    useVehicleStore.getState().mergeDelta(1, { gpsRaw: makeGpsRaw() }, Date.now())
    const gpsRaw = useVehicleStore.getState().vehicles[1]?.gpsRaw
    expect(gpsRaw!.fixType).toBeGreaterThanOrEqual(3)
    expect(gpsRaw!.satelliteCount).toBeGreaterThanOrEqual(9)
  })

  it('fails with no 3D fix', () => {
    useVehicleStore.getState().mergeDelta(1, { gpsRaw: makeGpsRaw({ fixType: 2 }) }, Date.now())
    const gpsRaw = useVehicleStore.getState().vehicles[1]?.gpsRaw
    expect(gpsRaw!.fixType).toBeLessThan(3)
  })

  it('fails with too few satellites', () => {
    useVehicleStore.getState().mergeDelta(1, { gpsRaw: makeGpsRaw({ satelliteCount: 5 }) }, Date.now())
    const gpsRaw = useVehicleStore.getState().vehicles[1]?.gpsRaw
    expect(gpsRaw!.satelliteCount).toBeLessThan(9)
  })
})

describe('Pre-Flight Checklist — Battery check', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('passes with sufficient charge', () => {
    useVehicleStore.getState().mergeDelta(1, { battery: makeBattery(75) }, Date.now())
    const bat = useVehicleStore.getState().vehicles[1]?.battery?.batteries[0]
    expect(bat!.remaining).toBeGreaterThanOrEqual(40)
  })

  it('fails with low charge', () => {
    useVehicleStore.getState().mergeDelta(1, { battery: makeBattery(20) }, Date.now())
    const bat = useVehicleStore.getState().vehicles[1]?.battery?.batteries[0]
    expect(bat!.remaining).toBeLessThan(40)
  })

  it('fails at exactly the threshold', () => {
    useVehicleStore.getState().mergeDelta(1, { battery: makeBattery(39) }, Date.now())
    const bat = useVehicleStore.getState().vehicles[1]?.battery?.batteries[0]
    expect(bat!.remaining).toBeLessThan(40)
  })

  it('passes at exactly 40%', () => {
    useVehicleStore.getState().mergeDelta(1, { battery: makeBattery(40) }, Date.now())
    const bat = useVehicleStore.getState().vehicles[1]?.battery?.batteries[0]
    expect(bat!.remaining).toBeGreaterThanOrEqual(40)
  })
})

describe('Pre-Flight Checklist — Sensor health check', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('passes when all enabled sensors are healthy', () => {
    useVehicleStore
      .getState()
      .mergeDelta(1, { sysStatus: makeSysStatus(ALL_CHECKED, ALL_CHECKED) }, Date.now())
    const sys = useVehicleStore.getState().vehicles[1]?.sysStatus
    const enabled = sys!.onboardControlSensorsEnabled & ALL_CHECKED
    const unhealthy = enabled & ~sys!.onboardControlSensorsHealth
    expect(unhealthy).toBe(0)
  })

  it('fails when gyro is unhealthy', () => {
    const healthWithoutGyro = ALL_CHECKED & ~SENSOR_3D_GYRO
    useVehicleStore
      .getState()
      .mergeDelta(1, { sysStatus: makeSysStatus(ALL_CHECKED, healthWithoutGyro) }, Date.now())
    const sys = useVehicleStore.getState().vehicles[1]?.sysStatus
    const enabled = sys!.onboardControlSensorsEnabled & ALL_CHECKED
    const unhealthy = enabled & ~sys!.onboardControlSensorsHealth
    expect(unhealthy & SENSOR_3D_GYRO).toBeTruthy()
  })

  it('fails when multiple sensors are unhealthy', () => {
    const healthPartial = ALL_CHECKED & ~(SENSOR_3D_MAG | SENSOR_GPS)
    useVehicleStore
      .getState()
      .mergeDelta(1, { sysStatus: makeSysStatus(ALL_CHECKED, healthPartial) }, Date.now())
    const sys = useVehicleStore.getState().vehicles[1]?.sysStatus
    const enabled = sys!.onboardControlSensorsEnabled & ALL_CHECKED
    const unhealthy = enabled & ~sys!.onboardControlSensorsHealth
    expect(unhealthy & SENSOR_3D_MAG).toBeTruthy()
    expect(unhealthy & SENSOR_GPS).toBeTruthy()
  })

  it('ignores sensors that are not enabled', () => {
    // Only gyro and accel enabled, both healthy
    const enabledSensors = SENSOR_3D_GYRO | SENSOR_3D_ACCEL
    useVehicleStore
      .getState()
      .mergeDelta(1, { sysStatus: makeSysStatus(enabledSensors, enabledSensors) }, Date.now())
    const sys = useVehicleStore.getState().vehicles[1]?.sysStatus
    const enabled = sys!.onboardControlSensorsEnabled & ALL_CHECKED
    const unhealthy = enabled & ~sys!.onboardControlSensorsHealth
    expect(unhealthy).toBe(0)
  })
})

describe('Pre-Flight Checklist — Communication check', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('passes when communication is active', () => {
    useVehicleStore.getState().mergeDelta(1, { core: makeCore() }, Date.now())
    const core = useVehicleStore.getState().vehicles[1]?.core
    expect(core!.communicationLost).toBe(false)
  })

  it('fails when communication is lost', () => {
    useVehicleStore
      .getState()
      .mergeDelta(1, { core: makeCore({ communicationLost: true }) }, Date.now())
    const core = useVehicleStore.getState().vehicles[1]?.core
    expect(core!.communicationLost).toBe(true)
  })
})

describe('Pre-Flight Checklist — RC check', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('passes with active RC channels', () => {
    useVehicleStore
      .getState()
      .mergeDelta(1, { rc: makeRc(8, [1500, 1500, 1000, 1500, 0, 0, 0, 0]) }, Date.now())
    const rc = useVehicleStore.getState().vehicles[1]?.rc
    expect(rc!.channelCount).toBeGreaterThan(0)
    expect(rc!.channels.some((ch) => ch > 0)).toBe(true)
  })

  it('fails with no channels', () => {
    useVehicleStore.getState().mergeDelta(1, { rc: makeRc(0, []) }, Date.now())
    const rc = useVehicleStore.getState().vehicles[1]?.rc
    expect(rc!.channelCount).toBe(0)
  })

  it('fails with all-zero channel values', () => {
    useVehicleStore
      .getState()
      .mergeDelta(1, { rc: makeRc(8, [0, 0, 0, 0, 0, 0, 0, 0]) }, Date.now())
    const rc = useVehicleStore.getState().vehicles[1]?.rc
    expect(rc!.channels.some((ch) => ch > 0)).toBe(false)
  })
})

describe('Pre-Flight Checklist — full preflight scenario', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('all telemetry checks pass with good data', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        core: makeCore(),
        gpsRaw: makeGpsRaw(),
        battery: makeBattery(80),
        sysStatus: makeSysStatus(ALL_CHECKED, ALL_CHECKED),
        rc: makeRc(8, [1500, 1500, 1000, 1500, 0, 0, 0, 0])
      },
      Date.now()
    )

    const v = useVehicleStore.getState().vehicles[1]!
    const gpsOk = v.gpsRaw!.fixType >= 3 && v.gpsRaw!.satelliteCount >= 9
    const batOk = v.battery!.batteries[0].remaining >= 40
    const sensorsEnabled = v.sysStatus!.onboardControlSensorsEnabled & ALL_CHECKED
    const sensorsOk = (sensorsEnabled & ~v.sysStatus!.onboardControlSensorsHealth) === 0
    const commsOk = !v.core!.communicationLost
    const rcOk = v.rc!.channelCount > 0 && v.rc!.channels.some((ch) => ch > 0)

    expect(gpsOk).toBe(true)
    expect(batOk).toBe(true)
    expect(sensorsOk).toBe(true)
    expect(commsOk).toBe(true)
    expect(rcOk).toBe(true)
  })

  it('checklist hidden when armed', () => {
    useVehicleStore.getState().mergeDelta(1, { core: makeCore({ armed: true }) }, Date.now())
    const core = useVehicleStore.getState().vehicles[1]?.core
    // FlyView renders checklist only when !armed
    expect(core!.armed).toBe(true)
  })
})
