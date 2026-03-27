// @vitest-environment node
import { describe, it, expect } from 'vitest'

/**
 * Tests for calibration completion detection via parameter values.
 * Mirrors the logic used in SummaryPage and SensorCalibrationPage
 * to determine if sensors have been calibrated.
 */

interface ParamEntry {
  value: number
}

/**
 * Check if a sensor is calibrated by testing if its offset parameter is non-zero.
 * Duplicated from SummaryPage/SensorCalibrationPage for unit testing.
 */
function isSensorCalibrated(parameters: Map<string, ParamEntry>, paramName: string): boolean {
  const p = parameters.get(paramName)
  return p !== undefined && p.value !== 0
}

/**
 * Check if RC is calibrated (RC1_MIN differs from default 1100).
 */
function isRcCalibrated(parameters: Map<string, ParamEntry>): boolean {
  const rc1Min = parameters.get('RC1_MIN')
  return rc1Min !== undefined && rc1Min.value !== 1100
}

describe('Calibration status parameter checks', () => {
  describe('isSensorCalibrated', () => {
    it('returns false when parameter is missing', () => {
      const params = new Map<string, ParamEntry>()
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(false)
    })

    it('returns false when parameter value is 0 (uncalibrated)', () => {
      const params = new Map<string, ParamEntry>([['INS_ACCOFFS_X', { value: 0 }]])
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(false)
    })

    it('returns true when parameter has non-zero value (calibrated)', () => {
      const params = new Map<string, ParamEntry>([['INS_ACCOFFS_X', { value: 0.123 }]])
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(true)
    })

    it('returns true for negative offset values', () => {
      const params = new Map<string, ParamEntry>([['COMPASS_OFS_X', { value: -15.3 }]])
      expect(isSensorCalibrated(params, 'COMPASS_OFS_X')).toBe(true)
    })

    it('checks accel calibration via INS_ACCOFFS_X', () => {
      const params = new Map<string, ParamEntry>([['INS_ACCOFFS_X', { value: 0.45 }]])
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(true)
    })

    it('checks compass calibration via COMPASS_OFS_X', () => {
      const params = new Map<string, ParamEntry>([['COMPASS_OFS_X', { value: 42.1 }]])
      expect(isSensorCalibrated(params, 'COMPASS_OFS_X')).toBe(true)
    })

    it('checks gyro calibration via INS_GYROFFS_X', () => {
      const params = new Map<string, ParamEntry>([['INS_GYROFFS_X', { value: -0.003 }]])
      expect(isSensorCalibrated(params, 'INS_GYROFFS_X')).toBe(true)
    })
  })

  describe('isRcCalibrated', () => {
    it('returns false when RC1_MIN is missing', () => {
      const params = new Map<string, ParamEntry>()
      expect(isRcCalibrated(params)).toBe(false)
    })

    it('returns false when RC1_MIN is default 1100 (uncalibrated)', () => {
      const params = new Map<string, ParamEntry>([['RC1_MIN', { value: 1100 }]])
      expect(isRcCalibrated(params)).toBe(false)
    })

    it('returns true when RC1_MIN differs from default', () => {
      const params = new Map<string, ParamEntry>([['RC1_MIN', { value: 982 }]])
      expect(isRcCalibrated(params)).toBe(true)
    })
  })

  describe('combined summary checks', () => {
    it('reports all uncalibrated for empty parameters', () => {
      const params = new Map<string, ParamEntry>()
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(false)
      expect(isSensorCalibrated(params, 'COMPASS_OFS_X')).toBe(false)
      expect(isSensorCalibrated(params, 'INS_GYROFFS_X')).toBe(false)
      expect(isRcCalibrated(params)).toBe(false)
    })

    it('reports all calibrated when parameters are set', () => {
      const params = new Map<string, ParamEntry>([
        ['INS_ACCOFFS_X', { value: 0.5 }],
        ['COMPASS_OFS_X', { value: -10 }],
        ['INS_GYROFFS_X', { value: 0.001 }],
        ['RC1_MIN', { value: 982 }]
      ])
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(true)
      expect(isSensorCalibrated(params, 'COMPASS_OFS_X')).toBe(true)
      expect(isSensorCalibrated(params, 'INS_GYROFFS_X')).toBe(true)
      expect(isRcCalibrated(params)).toBe(true)
    })

    it('reports partial calibration correctly', () => {
      const params = new Map<string, ParamEntry>([
        ['INS_ACCOFFS_X', { value: 0.5 }],
        ['COMPASS_OFS_X', { value: 0 }], // not calibrated
        ['INS_GYROFFS_X', { value: 0.001 }],
        ['RC1_MIN', { value: 1100 }] // default, not calibrated
      ])
      expect(isSensorCalibrated(params, 'INS_ACCOFFS_X')).toBe(true)
      expect(isSensorCalibrated(params, 'COMPASS_OFS_X')).toBe(false)
      expect(isSensorCalibrated(params, 'INS_GYROFFS_X')).toBe(true)
      expect(isRcCalibrated(params)).toBe(false)
    })
  })
})
