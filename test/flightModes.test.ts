// @vitest-environment node
import { describe, it, expect } from 'vitest'

/**
 * ArduPilot PWM thresholds for 6 flight mode slots.
 * Duplicated from FlightModesPage.tsx for unit testing.
 */
const PWM_RANGES = [
  { min: 0, max: 1230 },
  { min: 1231, max: 1360 },
  { min: 1361, max: 1490 },
  { min: 1491, max: 1620 },
  { min: 1621, max: 1749 },
  { min: 1750, max: 2200 }
]

function activeSlotForPwm(pwm: number): number {
  for (let i = 0; i < PWM_RANGES.length; i++) {
    if (pwm <= PWM_RANGES[i]!.max) return i + 1
  }
  return 6
}

describe('Flight mode slot PWM mapping', () => {
  it('maps PWM 0 to slot 1', () => {
    expect(activeSlotForPwm(0)).toBe(1)
  })

  it('maps PWM 1000 to slot 1 (typical low PWM)', () => {
    expect(activeSlotForPwm(1000)).toBe(1)
  })

  it('maps PWM 1230 to slot 1 (boundary)', () => {
    expect(activeSlotForPwm(1230)).toBe(1)
  })

  it('maps PWM 1231 to slot 2 (just above boundary)', () => {
    expect(activeSlotForPwm(1231)).toBe(2)
  })

  it('maps PWM 1360 to slot 2 (boundary)', () => {
    expect(activeSlotForPwm(1360)).toBe(2)
  })

  it('maps PWM 1361 to slot 3', () => {
    expect(activeSlotForPwm(1361)).toBe(3)
  })

  it('maps PWM 1490 to slot 3 (boundary)', () => {
    expect(activeSlotForPwm(1490)).toBe(3)
  })

  it('maps PWM 1491 to slot 4', () => {
    expect(activeSlotForPwm(1491)).toBe(4)
  })

  it('maps PWM 1620 to slot 4 (boundary)', () => {
    expect(activeSlotForPwm(1620)).toBe(4)
  })

  it('maps PWM 1621 to slot 5', () => {
    expect(activeSlotForPwm(1621)).toBe(5)
  })

  it('maps PWM 1749 to slot 5 (boundary)', () => {
    expect(activeSlotForPwm(1749)).toBe(5)
  })

  it('maps PWM 1750 to slot 6', () => {
    expect(activeSlotForPwm(1750)).toBe(6)
  })

  it('maps PWM 2000 to slot 6 (typical high PWM)', () => {
    expect(activeSlotForPwm(2000)).toBe(6)
  })

  it('maps PWM 2200 to slot 6 (max boundary)', () => {
    expect(activeSlotForPwm(2200)).toBe(6)
  })

  it('maps PWM above 2200 to slot 6 (overflow)', () => {
    expect(activeSlotForPwm(2500)).toBe(6)
  })

  it('maps typical center PWM 1500 to slot 4', () => {
    expect(activeSlotForPwm(1500)).toBe(4)
  })

  // Verify ArduPilot thresholds match QGroundControl reference: [1230, 1360, 1490, 1620, 1749]
  it('matches ArduPilot standard thresholds', () => {
    const thresholds = [1230, 1360, 1490, 1620, 1749]
    for (let i = 0; i < thresholds.length; i++) {
      expect(activeSlotForPwm(thresholds[i]!)).toBe(i + 1)
      expect(activeSlotForPwm(thresholds[i]! + 1)).toBe(i + 2)
    }
  })
})

/**
 * Simple / SuperSimple bitmask logic.
 * ArduPilot uses SIMPLE and SUPER_SIMPLE params as 6-bit bitmasks
 * where bit N corresponds to flight mode slot N+1.
 */
describe('Simple/SuperSimple bitmask operations', () => {
  /** Set bit for a slot (1-indexed) */
  function setBit(bitmask: number, slot: number): number {
    return bitmask | (1 << (slot - 1))
  }

  /** Clear bit for a slot (1-indexed) */
  function clearBit(bitmask: number, slot: number): number {
    return bitmask & ~(1 << (slot - 1))
  }

  /** Check bit for a slot (1-indexed) */
  function hasBit(bitmask: number, slot: number): boolean {
    return (bitmask & (1 << (slot - 1))) !== 0
  }

  it('sets bit for slot 1', () => {
    expect(setBit(0, 1)).toBe(1)
  })

  it('sets bit for slot 6', () => {
    expect(setBit(0, 6)).toBe(32)
  })

  it('preserves existing bits when setting', () => {
    expect(setBit(0b000101, 3)).toBe(0b000101 | 0b000100)
    // slot 3 was already set, result unchanged
    expect(setBit(0b000101, 3)).toBe(0b000101)
  })

  it('clears bit for slot 1', () => {
    expect(clearBit(0b111111, 1)).toBe(0b111110)
  })

  it('clears bit for slot 4', () => {
    expect(clearBit(0b001111, 4)).toBe(0b000111)
  })

  it('hasBit returns true for set slots', () => {
    const mask = 0b101010 // slots 2, 4, 6
    expect(hasBit(mask, 2)).toBe(true)
    expect(hasBit(mask, 4)).toBe(true)
    expect(hasBit(mask, 6)).toBe(true)
  })

  it('hasBit returns false for unset slots', () => {
    const mask = 0b101010 // slots 2, 4, 6
    expect(hasBit(mask, 1)).toBe(false)
    expect(hasBit(mask, 3)).toBe(false)
    expect(hasBit(mask, 5)).toBe(false)
  })

  it('round-trips set then clear', () => {
    let mask = 0
    mask = setBit(mask, 3)
    expect(hasBit(mask, 3)).toBe(true)
    mask = clearBit(mask, 3)
    expect(hasBit(mask, 3)).toBe(false)
    expect(mask).toBe(0)
  })

  it('handles all 6 slots independently', () => {
    let mask = 0
    for (let slot = 1; slot <= 6; slot++) {
      mask = setBit(mask, slot)
    }
    expect(mask).toBe(0b111111)
    for (let slot = 1; slot <= 6; slot++) {
      expect(hasBit(mask, slot)).toBe(true)
    }
  })
})
