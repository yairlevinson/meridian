// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  getParameterMetadata,
  validateParameterValue
} from '../src/shared-types/ipc/parameterMetadata'

describe('getParameterMetadata', () => {
  it('returns metadata for known parameters', () => {
    const meta = getParameterMetadata('BATT_CAPACITY')
    expect(meta).toBeDefined()
    expect(meta!.shortDescription).toBe('Battery capacity')
    expect(meta!.units).toBe('mAh')
    expect(meta!.min).toBe(0)
    expect(meta!.max).toBe(100000)
  })

  it('returns undefined for unknown parameters', () => {
    expect(getParameterMetadata('NONEXISTENT_PARAM')).toBeUndefined()
  })

  it('includes enum values for enum parameters', () => {
    const meta = getParameterMetadata('BATT_MONITOR')
    expect(meta).toBeDefined()
    expect(meta!.enumValues).toBeDefined()
    expect(meta!.enumValues![0]).toBe('Disabled')
    expect(meta!.enumValues![3]).toBe('Analog Voltage and Current')
  })

  it('has metadata for PID tuning parameters', () => {
    const meta = getParameterMetadata('ATC_RAT_RLL_P')
    expect(meta).toBeDefined()
    expect(meta!.shortDescription).toContain('Roll rate')
    expect(meta!.min).toBeDefined()
    expect(meta!.max).toBeDefined()
  })

  it('has metadata for failsafe parameters', () => {
    expect(getParameterMetadata('FS_THR_ENABLE')).toBeDefined()
    expect(getParameterMetadata('FS_BATT_ENABLE')).toBeDefined()
    expect(getParameterMetadata('FS_GCS_ENABLE')).toBeDefined()
  })

  it('has metadata for fence parameters', () => {
    expect(getParameterMetadata('FENCE_ENABLE')).toBeDefined()
    expect(getParameterMetadata('FENCE_ALT_MAX')).toBeDefined()
    expect(getParameterMetadata('FENCE_RADIUS')).toBeDefined()
  })

  it('has metadata for RC parameters', () => {
    expect(getParameterMetadata('RC1_MIN')).toBeDefined()
    expect(getParameterMetadata('RCMAP_ROLL')).toBeDefined()
  })

  it('has metadata for calibration offset parameters', () => {
    expect(getParameterMetadata('INS_ACCOFFS_X')).toBeDefined()
    expect(getParameterMetadata('COMPASS_OFS_X')).toBeDefined()
    expect(getParameterMetadata('INS_GYROFFS_X')).toBeDefined()
  })
})

describe('validateParameterValue', () => {
  it('returns null for values within range', () => {
    expect(validateParameterValue('BATT_CAPACITY', 5000)).toBeNull()
  })

  it('returns error for values below minimum', () => {
    const result = validateParameterValue('BATT_CAPACITY', -100)
    expect(result).not.toBeNull()
    expect(result).toContain('minimum')
    expect(result).toContain('0')
  })

  it('returns error for values above maximum', () => {
    const result = validateParameterValue('BATT_CAPACITY', 200000)
    expect(result).not.toBeNull()
    expect(result).toContain('maximum')
    expect(result).toContain('100000')
  })

  it('returns null for unknown parameters', () => {
    expect(validateParameterValue('UNKNOWN_PARAM', 999)).toBeNull()
  })

  it('returns null when value equals min', () => {
    expect(validateParameterValue('BATT_CAPACITY', 0)).toBeNull()
  })

  it('returns null when value equals max', () => {
    expect(validateParameterValue('BATT_CAPACITY', 100000)).toBeNull()
  })

  it('validates PID parameters', () => {
    expect(validateParameterValue('ATC_RAT_RLL_P', 0.1)).toBeNull()
    expect(validateParameterValue('ATC_RAT_RLL_P', 0.0001)).not.toBeNull() // below min
    expect(validateParameterValue('ATC_RAT_RLL_P', 1.0)).not.toBeNull() // above max
  })

  it('validates fence parameters', () => {
    expect(validateParameterValue('FENCE_ALT_MAX', 100)).toBeNull()
    expect(validateParameterValue('FENCE_ALT_MAX', 5)).not.toBeNull() // below min 10
    expect(validateParameterValue('FENCE_ALT_MAX', 2000)).not.toBeNull() // above max 1000
  })
})
