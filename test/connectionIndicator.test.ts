// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import type { CoreGroup, SysStatusGroup } from '../src/shared-types/ipc/VehicleState'

/**
 * ConnectionIndicator calibration-health logic.
 *
 * Mirrors the bitmask check in StatusIcons.tsx → ConnectionIndicator:
 *   CALIBRATION_SENSORS = GYRO | ACCEL | GPS | AHRS
 *   enabledCal = sysStatus.onboardControlSensorsEnabled & CALIBRATION_SENSORS
 *   healthyCal = sysStatus.onboardControlSensorsHealth  & CALIBRATION_SENSORS
 *   calOk      = (healthyCal & enabledCal) === enabledCal
 *
 * Also tests the commOk guard: when communicationLost is true, calibration
 * should not show as failed (the dot should not be red due to stale data).
 */

const SENSOR_3D_GYRO = 1 << 0
const SENSOR_3D_ACCEL = 1 << 1
const SENSOR_3D_MAG = 1 << 2
const SENSOR_ABSOLUTE_PRESSURE = 1 << 3
const SENSOR_GPS = 1 << 5
const SENSOR_AHRS = 1 << 21

// Must match StatusIcons.tsx CALIBRATION_SENSORS
const CALIBRATION_SENSORS = SENSOR_3D_GYRO | SENSOR_3D_ACCEL | SENSOR_GPS | SENSOR_AHRS

/** Pure function duplicating ConnectionIndicator's calibration check */
function isCalibrationOk(enabled: number, health: number): boolean {
  const enabledCal = enabled & CALIBRATION_SENSORS
  const healthyCal = health & CALIBRATION_SENSORS
  return (healthyCal & enabledCal) === enabledCal
}

/** CommOk guard — mirrors ConnectionIndicator's commOk derivation */
function isCommOk(core: CoreGroup | undefined): boolean {
  return core != null && !core.communicationLost
}

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

describe('ConnectionIndicator — calibration bitmask', () => {
  it('passes when all CALIBRATION_SENSORS bits are healthy', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })

  it('passes when health has extra bits beyond CALIBRATION_SENSORS', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS | (1 << 10) | (1 << 15)
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })

  it('fails when GYRO is enabled but not healthy', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS & ~SENSOR_3D_GYRO
    expect(isCalibrationOk(enabled, health)).toBe(false)
  })

  it('fails when ACCEL is enabled but not healthy', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS & ~SENSOR_3D_ACCEL
    expect(isCalibrationOk(enabled, health)).toBe(false)
  })

  it('fails when GPS is enabled but not healthy', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS & ~SENSOR_GPS
    expect(isCalibrationOk(enabled, health)).toBe(false)
  })

  it('fails when AHRS is enabled but not healthy', () => {
    const enabled = CALIBRATION_SENSORS
    const health = CALIBRATION_SENSORS & ~SENSOR_AHRS
    expect(isCalibrationOk(enabled, health)).toBe(false)
  })

  it('passes when a non-checked sensor (MAG) is unhealthy', () => {
    const enabled = CALIBRATION_SENSORS | SENSOR_3D_MAG
    const health = CALIBRATION_SENSORS // MAG enabled but not in health
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })

  it('passes when a non-checked sensor (BARO) is unhealthy', () => {
    const enabled = CALIBRATION_SENSORS | SENSOR_ABSOLUTE_PRESSURE
    const health = CALIBRATION_SENSORS // BARO enabled but not in health
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })

  it('passes with real PX4 SIH bitmask values (the bug scenario)', () => {
    // Actual values from PX4 SIH:
    //   enabled = 0x221000d  (gyro, accel, mag, baro, AHRS, and others)
    //   health  = 0x20208033 (gyro, accel, GPS, and others — but NOT mag, baro)
    const enabled = 0x221000d
    const health = 0x20208033
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })

  it('would have failed with the old check that included MAG and BARO', () => {
    // This is the original bug: checking all 4 low bits (gyro, accel, mag, baro)
    const OLD_CALIBRATION_SENSORS =
      SENSOR_3D_GYRO | SENSOR_3D_ACCEL | SENSOR_3D_MAG | SENSOR_ABSOLUTE_PRESSURE

    const enabled = 0x221000d
    const health = 0x20208033

    const enabledCal = enabled & OLD_CALIBRATION_SENSORS
    const healthyCal = health & OLD_CALIBRATION_SENSORS
    const oldCalOk = (healthyCal & enabledCal) === enabledCal

    // Confirms the old logic would fail — this is the regression we're preventing
    expect(oldCalOk).toBe(false)
  })

  it('passes when not all CALIBRATION_SENSORS are enabled', () => {
    // Only gyro and accel enabled (no GPS or AHRS)
    const enabled = SENSOR_3D_GYRO | SENSOR_3D_ACCEL
    const health = SENSOR_3D_GYRO | SENSOR_3D_ACCEL
    expect(isCalibrationOk(enabled, health)).toBe(true)
  })
})

describe('ConnectionIndicator — commOk guard', () => {
  beforeEach(() => {
    useVehicleStore.setState({ vehicles: {}, activeVehicleId: null, ipcLatency: 0, mergeCount: 0 })
  })

  it('returns false when core is undefined (no vehicle)', () => {
    expect(isCommOk(undefined)).toBe(false)
  })

  it('returns true when connected and communicationLost is false', () => {
    expect(isCommOk(makeCore())).toBe(true)
  })

  it('returns false when communicationLost is true', () => {
    expect(isCommOk(makeCore({ communicationLost: true }))).toBe(false)
  })

  it('stale store data: core exists but communicationLost — should not report green', () => {
    // Simulate vehicle connected then lost: core remains in store with communicationLost=true
    useVehicleStore.getState().mergeDelta(1, { core: makeCore() }, Date.now())
    useVehicleStore
      .getState()
      .mergeDelta(1, { core: makeCore({ communicationLost: true }) }, Date.now())

    const core = useVehicleStore.getState().vehicles[1]?.core
    expect(core).toBeDefined()
    expect(isCommOk(core)).toBe(false)
  })

  it('stale store data: sysStatus exists but comm lost — calibration should not show failed', () => {
    // Vehicle was connected with healthy sensors, then comm lost.
    // The sysStatus stays in store. The UI should NOT evaluate calibration when comm is lost.
    const sysStatus = makeSysStatus(CALIBRATION_SENSORS, 0) // all unhealthy
    useVehicleStore.getState().mergeDelta(
      1,
      {
        core: makeCore({ communicationLost: true }),
        sysStatus
      },
      Date.now()
    )

    const core = useVehicleStore.getState().vehicles[1]?.core
    const commOk = isCommOk(core)

    // Even though sensors are unhealthy, commOk is false so UI should show "No data"
    // not "Needs calibration" — the calibration check result should be gated by commOk
    expect(commOk).toBe(false)
    // Mirrors: ok = !commOk || calOk → true (because !commOk)
    const calOk = isCalibrationOk(
      sysStatus.onboardControlSensorsEnabled,
      sysStatus.onboardControlSensorsHealth
    )
    expect(!commOk || calOk).toBe(true)
  })
})
