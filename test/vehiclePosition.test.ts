// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { VehicleState } from '../src/main/vehicleState'

/**
 * Tests for vehicle position handling in VehicleState.
 *
 * Covers:
 * - LOCAL_POSITION_NED as fallback when GLOBAL_POSITION_INT is unavailable (PX4 SIH)
 * - GLOBAL_POSITION_INT takes priority over LOCAL_POSITION_NED
 * - ATTITUDE_QUATERNION to Euler conversion
 * - Continuous position updates (regression: LOCAL_POSITION_NED was only applied once)
 */

const MSG_ATTITUDE_QUATERNION = 31
const MSG_LOCAL_POSITION_NED = 32
const MSG_GLOBAL_POSITION_INT = 33
const MSG_HOME_POSITION = 242

// Tel Aviv home: 32.08°N, 34.78°E
const HOME_LAT = 32.08
const HOME_LON = 34.78
const HOME_ALT = 20

function makeHomePosition(lat = HOME_LAT, lon = HOME_LON, alt = HOME_ALT): Record<string, unknown> {
  return {
    latitude: Math.round(lat * 1e7),
    longitude: Math.round(lon * 1e7),
    altitude: Math.round(alt * 1000),
    x: 0,
    y: 0,
    z: 0,
    q: [1, 0, 0, 0],
    approachX: 0,
    approachY: 0,
    approachZ: 0,
    timeUsec: 0
  }
}

function makeLocalPositionNed(
  x: number,
  y: number,
  z: number,
  vx = 0,
  vy = 0,
  vz = 0
): Record<string, unknown> {
  return {
    timeBootMs: 1000,
    x,
    y,
    z,
    vx,
    vy,
    vz
  }
}

function makeGlobalPositionInt(
  lat: number,
  lon: number,
  alt: number,
  relativeAlt = 0,
  vx = 0,
  vy = 0,
  vz = 0,
  hdg = 0
): Record<string, unknown> {
  return {
    lat: Math.round(lat * 1e7),
    lon: Math.round(lon * 1e7),
    alt: Math.round(alt * 1000),
    relativeAlt: Math.round(relativeAlt * 1000),
    vx: Math.round(vx * 100),
    vy: Math.round(vy * 100),
    vz: Math.round(vz * 100),
    hdg: Math.round(hdg * 100)
  }
}

function makeAttitudeQuaternion(roll: number, pitch: number, yaw: number): Record<string, unknown> {
  // Convert Euler to quaternion (ZYX convention)
  const cr = Math.cos(roll / 2),
    sr = Math.sin(roll / 2)
  const cp = Math.cos(pitch / 2),
    sp = Math.sin(pitch / 2)
  const cy = Math.cos(yaw / 2),
    sy = Math.sin(yaw / 2)
  return {
    timeBootMs: 1000,
    q1: cr * cp * cy + sr * sp * sy,
    q2: sr * cp * cy - cr * sp * sy,
    q3: cr * sp * cy + sr * cp * sy,
    q4: cr * cp * sy - sr * sp * cy,
    rollspeed: 0,
    pitchspeed: 0,
    yawspeed: 0,
    reprOffsetQ: [1, 0, 0, 0]
  }
}

describe('VehicleState — LOCAL_POSITION_NED fallback', () => {
  let state: VehicleState

  beforeEach(() => {
    state = new VehicleState()
  })

  it('ignores LOCAL_POSITION_NED before home position is set', () => {
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(10, 20, -5))
    const delta = state.getDelta()
    expect(delta.gps).toBeUndefined()
  })

  it('converts LOCAL_POSITION_NED to lat/lon using home position', () => {
    state.handleMessage(MSG_HOME_POSITION, makeHomePosition())
    state.getDelta() // clear dirty

    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(0, 0, 0))
    const delta = state.getDelta()
    expect(delta.gps).toBeDefined()
    expect(delta.gps!.lat).toBeCloseTo(HOME_LAT, 4)
    expect(delta.gps!.lon).toBeCloseTo(HOME_LON, 4)
  })

  it('applies NED offset from home correctly', () => {
    state.handleMessage(MSG_HOME_POSITION, makeHomePosition())
    state.getDelta()

    // 111.32m north ≈ 0.001° lat
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(111.32, 0, 0))
    const delta = state.getDelta()
    expect(delta.gps!.lat).toBeCloseTo(HOME_LAT + 0.001, 4)
    expect(delta.gps!.lon).toBeCloseTo(HOME_LON, 4)
  })

  it('continuously updates position on each LOCAL_POSITION_NED message', () => {
    state.handleMessage(MSG_HOME_POSITION, makeHomePosition())
    state.getDelta()

    // First position
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(100, 0, 0))
    const delta1 = state.getDelta()
    const lat1 = delta1.gps!.lat

    // Second position — must update, not be blocked
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(200, 0, 0))
    const delta2 = state.getDelta()
    expect(delta2.gps).toBeDefined()
    expect(delta2.gps!.lat).toBeGreaterThan(lat1)

    // Third position — still updating
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(300, 0, 0))
    const delta3 = state.getDelta()
    expect(delta3.gps).toBeDefined()
    expect(delta3.gps!.lat).toBeGreaterThan(delta2.gps!.lat)
  })

  it('stops using LOCAL_POSITION_NED once GLOBAL_POSITION_INT arrives', () => {
    state.handleMessage(MSG_HOME_POSITION, makeHomePosition())
    state.getDelta()

    // LOCAL_POSITION_NED works initially
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(100, 0, 0))
    const d1 = state.getDelta()
    expect(d1.gps).toBeDefined()

    // GLOBAL_POSITION_INT arrives — takes over
    state.handleMessage(MSG_GLOBAL_POSITION_INT, makeGlobalPositionInt(33.0, 35.0, 100))
    const d2 = state.getDelta()
    expect(d2.gps!.lat).toBeCloseTo(33.0, 4)

    // LOCAL_POSITION_NED should now be ignored
    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(500, 500, 0))
    const d3 = state.getDelta()
    expect(d3.gps).toBeUndefined() // no update — LOCAL_POSITION_NED blocked
  })

  it('computes altitude as homeAlt - z (NED z is down)', () => {
    state.handleMessage(MSG_HOME_POSITION, makeHomePosition())
    state.getDelta()

    state.handleMessage(MSG_LOCAL_POSITION_NED, makeLocalPositionNed(0, 0, -10))
    const delta = state.getDelta()
    expect(delta.gps!.alt).toBeCloseTo(HOME_ALT + 10, 1)
  })
})

describe('VehicleState — ATTITUDE_QUATERNION', () => {
  let state: VehicleState

  beforeEach(() => {
    state = new VehicleState()
  })

  it('converts quaternion to Euler angles', () => {
    const yaw = Math.PI / 4 // 45°
    state.handleMessage(MSG_ATTITUDE_QUATERNION, makeAttitudeQuaternion(0, 0, yaw))
    const delta = state.getDelta()
    expect(delta.attitude).toBeDefined()
    expect(delta.attitude!.yaw).toBeCloseTo(yaw, 3)
    expect(delta.attitude!.roll).toBeCloseTo(0, 3)
    expect(delta.attitude!.pitch).toBeCloseTo(0, 3)
  })

  it('converts roll correctly', () => {
    const roll = 0.3
    state.handleMessage(MSG_ATTITUDE_QUATERNION, makeAttitudeQuaternion(roll, 0, 0))
    const delta = state.getDelta()
    expect(delta.attitude!.roll).toBeCloseTo(roll, 3)
  })

  it('converts pitch correctly', () => {
    const pitch = -0.2
    state.handleMessage(MSG_ATTITUDE_QUATERNION, makeAttitudeQuaternion(0, pitch, 0))
    const delta = state.getDelta()
    expect(delta.attitude!.pitch).toBeCloseTo(pitch, 3)
  })

  it('prefers ATTITUDE_QUATERNION over ATTITUDE when both received', () => {
    const qYaw = Math.PI / 3
    state.handleMessage(MSG_ATTITUDE_QUATERNION, makeAttitudeQuaternion(0, 0, qYaw))
    state.getDelta()

    // ATTITUDE (msg 30) should be ignored after ATTITUDE_QUATERNION
    state.handleMessage(30, { roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 })
    const delta = state.getDelta()
    // Should NOT produce a new attitude update (ignored)
    expect(delta.attitude).toBeUndefined()
  })
})
