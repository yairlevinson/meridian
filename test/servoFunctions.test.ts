// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  SERVO_FUNCTIONS,
  FUNCTION_OPTIONS,
  getServoFunctionName
} from '../src/renderer/src/setupview/actuators/servoFunctions'

describe('servoFunctions — SERVO_FUNCTIONS map', () => {
  it('contains Motor1–Motor8 (values 33–40)', () => {
    for (let i = 0; i < 8; i++) {
      expect(SERVO_FUNCTIONS[33 + i]).toBe(`Motor${i + 1}`)
    }
  })

  it('contains Disabled (0)', () => {
    expect(SERVO_FUNCTIONS[0]).toBe('Disabled')
  })

  it('contains RCPassThru (1)', () => {
    expect(SERVO_FUNCTIONS[1]).toBe('RCPassThru')
  })

  it('contains control surfaces (Aileron=4, Elevator=19, Rudder=21)', () => {
    expect(SERVO_FUNCTIONS[4]).toBe('Aileron')
    expect(SERVO_FUNCTIONS[19]).toBe('Elevator')
    expect(SERVO_FUNCTIONS[21]).toBe('Rudder')
  })

  it('contains GPIO (-1)', () => {
    expect(SERVO_FUNCTIONS[-1]).toBe('GPIO')
  })

  it('contains mount functions', () => {
    expect(SERVO_FUNCTIONS[6]).toBe('Mount1Yaw')
    expect(SERVO_FUNCTIONS[7]).toBe('Mount1Pitch')
    expect(SERVO_FUNCTIONS[8]).toBe('Mount1Roll')
  })

  it('contains extended motors Motor9–Motor12 (82–85)', () => {
    expect(SERVO_FUNCTIONS[82]).toBe('Motor9')
    expect(SERVO_FUNCTIONS[83]).toBe('Motor10')
    expect(SERVO_FUNCTIONS[84]).toBe('Motor11')
    expect(SERVO_FUNCTIONS[85]).toBe('Motor12')
  })
})

describe('servoFunctions — FUNCTION_OPTIONS', () => {
  it('is sorted by numeric value ascending', () => {
    for (let i = 1; i < FUNCTION_OPTIONS.length; i++) {
      expect(FUNCTION_OPTIONS[i].value).toBeGreaterThan(FUNCTION_OPTIONS[i - 1].value)
    }
  })

  it('each entry has a label containing the value in parentheses', () => {
    for (const opt of FUNCTION_OPTIONS) {
      expect(opt.label).toContain(`(${opt.value})`)
    }
  })

  it('has the same number of entries as SERVO_FUNCTIONS', () => {
    expect(FUNCTION_OPTIONS).toHaveLength(Object.keys(SERVO_FUNCTIONS).length)
  })

  it('GPIO (-1) is the first entry', () => {
    expect(FUNCTION_OPTIONS[0].value).toBe(-1)
    expect(FUNCTION_OPTIONS[0].label).toContain('GPIO')
  })

  it('Disabled (0) is the second entry', () => {
    expect(FUNCTION_OPTIONS[1].value).toBe(0)
    expect(FUNCTION_OPTIONS[1].label).toContain('Disabled')
  })
})

describe('servoFunctions — getServoFunctionName', () => {
  it('returns null for undefined', () => {
    expect(getServoFunctionName(undefined)).toBeNull()
  })

  it('returns null for Disabled (0)', () => {
    expect(getServoFunctionName(0)).toBeNull()
  })

  it('returns the function name for known values', () => {
    expect(getServoFunctionName(33)).toBe('Motor1')
    expect(getServoFunctionName(34)).toBe('Motor2')
    expect(getServoFunctionName(4)).toBe('Aileron')
    expect(getServoFunctionName(19)).toBe('Elevator')
    expect(getServoFunctionName(21)).toBe('Rudder')
    expect(getServoFunctionName(1)).toBe('RCPassThru')
  })

  it('returns null for unknown numeric values', () => {
    expect(getServoFunctionName(999)).toBeNull()
    expect(getServoFunctionName(42)).toBeNull()
  })

  it('returns the name for GPIO (-1)', () => {
    expect(getServoFunctionName(-1)).toBe('GPIO')
  })
})
