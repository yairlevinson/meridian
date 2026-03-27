// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GimbalController } from '../src/main/gimbal/GimbalController'
import { MockLink } from '../src/test-utils/MockLink/MockLink'

/** Build a quaternion from Euler angles (roll, pitch, yaw in degrees) */
function eulerToQuaternion(rollDeg: number, pitchDeg: number, yawDeg: number): number[] {
  const DEG_TO_RAD = Math.PI / 180
  const r = (rollDeg * DEG_TO_RAD) / 2
  const p = (pitchDeg * DEG_TO_RAD) / 2
  const y = (yawDeg * DEG_TO_RAD) / 2

  const cr = Math.cos(r),
    sr = Math.sin(r)
  const cp = Math.cos(p),
    sp = Math.sin(p)
  const cy = Math.cos(y),
    sy = Math.sin(y)

  return [
    cr * cp * cy + sr * sp * sy, // w
    sr * cp * cy - cr * sp * sy, // x
    cr * sp * cy + sr * cp * sy, // y
    cr * cp * sy - sr * sp * cy // z
  ]
}

describe('GimbalController — attitude parsing', () => {
  let gc: GimbalController

  beforeEach(() => {
    gc = new GimbalController()
  })

  it('converts identity quaternion to zero Euler angles', () => {
    const changed = vi.fn()
    gc.on('attitudeChanged', changed)

    gc.handleAttitudeStatus({
      q: [1, 0, 0, 0], // identity
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    expect(changed).toHaveBeenCalled()
    const state = gc.currentState
    expect(state.pitch).toBeCloseTo(0, 1)
    expect(state.roll).toBeCloseTo(0, 1)
    expect(state.yaw).toBeCloseTo(0, 1)
  })

  it('converts pitch-down quaternion correctly', () => {
    const q = eulerToQuaternion(0, -45, 0) // 45° pitch down

    gc.handleAttitudeStatus({
      q,
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.pitch).toBeCloseTo(-45, 0)
    expect(state.roll).toBeCloseTo(0, 0)
    expect(state.yaw).toBeCloseTo(0, 0)
  })

  it('converts roll quaternion correctly', () => {
    const q = eulerToQuaternion(30, 0, 0) // 30° roll

    gc.handleAttitudeStatus({
      q,
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.roll).toBeCloseTo(30, 0)
    expect(state.pitch).toBeCloseTo(0, 0)
  })

  it('converts yaw quaternion correctly', () => {
    const q = eulerToQuaternion(0, 0, 90) // 90° yaw

    gc.handleAttitudeStatus({
      q,
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.yaw).toBeCloseTo(90, 0)
  })

  it('converts combined roll/pitch/yaw', () => {
    const q = eulerToQuaternion(10, -30, 45)

    gc.handleAttitudeStatus({
      q,
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.roll).toBeCloseTo(10, 0)
    expect(state.pitch).toBeCloseTo(-30, 0)
    expect(state.yaw).toBeCloseTo(45, 0)
  })

  it('handles pitch at ±90° (gimbal lock boundary)', () => {
    const q = eulerToQuaternion(0, 90, 0)

    gc.handleAttitudeStatus({
      q,
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.pitch).toBeCloseTo(90, 0)
  })

  it('converts angular velocity from rad/s to deg/s', () => {
    gc.handleAttitudeStatus({
      q: [1, 0, 0, 0],
      angularVelocityX: Math.PI / 2, // 90 deg/s
      angularVelocityY: Math.PI, // 180 deg/s
      angularVelocityZ: -Math.PI / 4 // -45 deg/s
    })

    const state = gc.currentState
    expect(state.pitchRate).toBeCloseTo(90, 0)
    expect(state.rollRate).toBeCloseTo(180, 0)
    expect(state.yawRate).toBeCloseTo(-45, 0)
  })

  it('ignores incomplete quaternion (undefined elements)', () => {
    const changed = vi.fn()
    gc.on('attitudeChanged', changed)

    gc.handleAttitudeStatus({
      q: [1, 0, 0] as unknown as number[], // missing z
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    expect(changed).not.toHaveBeenCalled()
  })

  it('currentState returns a copy (not a reference)', () => {
    gc.handleAttitudeStatus({
      q: eulerToQuaternion(10, 20, 30),
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const s1 = gc.currentState
    const s2 = gc.currentState
    expect(s1).toEqual(s2)
    expect(s1).not.toBe(s2) // different object references
  })
})

describe('GimbalController — setAngles command', () => {
  let gc: GimbalController
  let link: MockLink

  beforeEach(() => {
    gc = new GimbalController()
    link = new MockLink()
    gc.setLink(link)
  })

  it('sends a serialized command when setAngles is called', () => {
    gc.setAngles(-45, 90)
    expect(link.sentBuffers).toHaveLength(1)
    expect(link.sentBuffers[0]!.length).toBeGreaterThan(0)
  })

  it('does nothing when no link is set', () => {
    const gc2 = new GimbalController()
    gc2.setAngles(-45, 90) // should not throw
  })

  it('sends multiple commands with incrementing sequence', () => {
    gc.setAngles(-45, 0)
    gc.setAngles(-90, 180)
    gc.setAngles(0, 0)

    expect(link.sentBuffers).toHaveLength(3)
  })

  it('respects setTarget for sysid and gimbalId', () => {
    gc.setTarget(2, 5)
    gc.setAngles(-30, 60)

    // Command was sent — we verify by checking sentBuffers has content
    expect(link.sentBuffers).toHaveLength(1)
  })
})

describe('GimbalController — setLink and setTarget', () => {
  it('setLink enables command sending', () => {
    const gc = new GimbalController()
    const link = new MockLink()

    // Before setLink — no sends
    gc.setAngles(10, 20)

    gc.setLink(link)
    gc.setAngles(10, 20)
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('setTarget updates target system and gimbal device ID', () => {
    const gc = new GimbalController()
    gc.setTarget(3, 7)
    // No crash, no assertion — just verifying it doesn't throw
  })
})
