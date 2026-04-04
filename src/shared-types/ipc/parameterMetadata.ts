import type { ParameterMetaData } from './ParameterTypes'

/**
 * Built-in parameter metadata for common ArduPilot parameters.
 * In a full implementation this would be loaded from ArduPilot's JSON metadata files.
 * This provides basic descriptions, ranges, and units for the most commonly
 * used parameters to improve the parameter editor UX.
 */

type PartialMeta = Pick<ParameterMetaData, 'shortDescription' | 'units'> &
  Partial<Pick<ParameterMetaData, 'min' | 'max' | 'increment' | 'enumValues'>>

const META: Record<string, PartialMeta> = {
  // Battery
  BATT_MONITOR: {
    shortDescription: 'Battery monitoring type',
    units: '',
    enumValues: {
      0: 'Disabled',
      3: 'Analog Voltage and Current',
      4: 'Analog Voltage Only',
      5: 'Solo',
      6: 'Bebop',
      7: 'SMBus-Generic',
      8: 'UAVCAN-BatteryInfo'
    }
  },
  BATT_CAPACITY: { shortDescription: 'Battery capacity', units: 'mAh', min: 0, max: 100000 },
  BATT_VOLT_PIN: { shortDescription: 'Analog pin for voltage sensing', units: '' },
  BATT_CURR_PIN: { shortDescription: 'Analog pin for current sensing', units: '' },
  BATT_VOLT_MULT: { shortDescription: 'Voltage multiplier', units: '', min: 0 },
  BATT_AMP_PERVLT: { shortDescription: 'Amps per volt', units: 'A/V', min: 0 },
  BATT_ARM_VOLT: { shortDescription: 'Minimum arming voltage', units: 'V', min: 0 },
  BATT_ARM_MAH: { shortDescription: 'Minimum arming capacity remaining', units: 'mAh', min: 0 },

  // Failsafe
  FS_THR_ENABLE: {
    shortDescription: 'Throttle failsafe action',
    units: '',
    enumValues: { 0: 'Disabled', 1: 'Always RTL', 2: 'Continue in Auto', 3: 'Always Land' }
  },
  FS_THR_VALUE: {
    shortDescription: 'Throttle failsafe PWM value',
    units: 'PWM',
    min: 925,
    max: 1100
  },
  FS_BATT_ENABLE: {
    shortDescription: 'Battery failsafe action',
    units: '',
    enumValues: { 0: 'Disabled', 1: 'Land', 2: 'RTL' }
  },
  FS_BATT_VOLTAGE: { shortDescription: 'Battery failsafe voltage', units: 'V', min: 0 },
  FS_BATT_MAH: { shortDescription: 'Battery failsafe mAh', units: 'mAh', min: 0 },
  FS_GCS_ENABLE: {
    shortDescription: 'GCS failsafe action',
    units: '',
    enumValues: { 0: 'Disabled', 1: 'Always RTL', 2: 'Continue in Auto' }
  },

  // Fence
  FENCE_ENABLE: {
    shortDescription: 'Enable geofence',
    units: '',
    enumValues: { 0: 'Disabled', 1: 'Enabled' }
  },
  FENCE_TYPE: { shortDescription: 'Fence type bitmask', units: '', min: 0, max: 7 },
  FENCE_ALT_MAX: { shortDescription: 'Maximum altitude fence', units: 'm', min: 10, max: 1000 },
  FENCE_RADIUS: { shortDescription: 'Circular fence radius', units: 'm', min: 30, max: 10000 },
  FENCE_ACTION: {
    shortDescription: 'Fence breach action',
    units: '',
    enumValues: { 0: 'Report Only', 1: 'RTL or Land', 2: 'Always Land' }
  },

  // Arming
  ARMING_CHECK: { shortDescription: 'Pre-arm checks bitmask', units: '', min: 0, max: 65535 },

  // Frame
  FRAME_CLASS: {
    shortDescription: 'Frame class',
    units: '',
    enumValues: {
      0: 'Undefined',
      1: 'Quad',
      2: 'Hexa',
      3: 'Octa',
      4: 'OctaQuad',
      5: 'Y6',
      6: 'Heli',
      7: 'Tri',
      9: 'Single',
      10: 'Coax',
      11: 'BiCopter',
      12: 'Heli Dual',
      13: 'DodecaHexa',
      14: 'HeliQuad'
    }
  },
  FRAME_TYPE: {
    shortDescription: 'Frame type',
    units: '',
    enumValues: {
      0: 'Plus',
      1: 'X',
      2: 'V',
      3: 'H',
      4: 'V-Tail',
      5: 'A-Tail',
      10: 'Y6B',
      12: 'BetaFlightX',
      13: 'DJIX',
      14: 'ClockwiseX',
      18: 'BetaFlightXReversed'
    }
  },

  // Flight modes
  FLTMODE_CH: { shortDescription: 'Flight mode channel', units: '', min: 1, max: 16 },
  FLTMODE1: { shortDescription: 'Flight mode 1', units: '' },
  FLTMODE2: { shortDescription: 'Flight mode 2', units: '' },
  FLTMODE3: { shortDescription: 'Flight mode 3', units: '' },
  FLTMODE4: { shortDescription: 'Flight mode 4', units: '' },
  FLTMODE5: { shortDescription: 'Flight mode 5', units: '' },
  FLTMODE6: { shortDescription: 'Flight mode 6', units: '' },
  SIMPLE: { shortDescription: 'Simple mode bitmask for flight modes', units: '', min: 0, max: 63 },
  SUPER_SIMPLE: {
    shortDescription: 'Super simple mode bitmask for flight modes',
    units: '',
    min: 0,
    max: 63
  },

  // Board orientation
  AHRS_ORIENTATION: {
    shortDescription: 'Board orientation (rotation)',
    units: '',
    min: 0,
    max: 42
  },

  // RC
  RC1_MIN: { shortDescription: 'RC channel 1 minimum PWM', units: 'PWM', min: 800, max: 2200 },
  RC1_MAX: { shortDescription: 'RC channel 1 maximum PWM', units: 'PWM', min: 800, max: 2200 },
  RC1_TRIM: { shortDescription: 'RC channel 1 trim PWM', units: 'PWM', min: 800, max: 2200 },
  RC1_REVERSED: {
    shortDescription: 'RC channel 1 reversed',
    units: '',
    enumValues: { 0: 'Normal', 1: 'Reversed' }
  },
  RCMAP_ROLL: { shortDescription: 'Roll channel mapping', units: '', min: 1, max: 16 },
  RCMAP_PITCH: { shortDescription: 'Pitch channel mapping', units: '', min: 1, max: 16 },
  RCMAP_YAW: { shortDescription: 'Yaw channel mapping', units: '', min: 1, max: 16 },
  RCMAP_THROTTLE: { shortDescription: 'Throttle channel mapping', units: '', min: 1, max: 16 },

  // PID Tuning — Roll Rate
  ATC_RAT_RLL_P: {
    shortDescription: 'Roll rate P gain',
    units: '',
    min: 0.001,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_RLL_I: {
    shortDescription: 'Roll rate I gain',
    units: '',
    min: 0,
    max: 2,
    increment: 0.01
  },
  ATC_RAT_RLL_D: {
    shortDescription: 'Roll rate D gain',
    units: '',
    min: 0,
    max: 0.05,
    increment: 0.0001
  },
  ATC_RAT_RLL_FF: {
    shortDescription: 'Roll rate feedforward',
    units: '',
    min: 0,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_RLL_FLTD: { shortDescription: 'Roll rate D-term filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_RLL_FLTT: { shortDescription: 'Roll rate target filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_RLL_IMAX: { shortDescription: 'Roll rate I-term maximum', units: '', min: 0, max: 1 },

  // PID Tuning — Pitch Rate
  ATC_RAT_PIT_P: {
    shortDescription: 'Pitch rate P gain',
    units: '',
    min: 0.001,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_PIT_I: {
    shortDescription: 'Pitch rate I gain',
    units: '',
    min: 0,
    max: 2,
    increment: 0.01
  },
  ATC_RAT_PIT_D: {
    shortDescription: 'Pitch rate D gain',
    units: '',
    min: 0,
    max: 0.05,
    increment: 0.0001
  },
  ATC_RAT_PIT_FF: {
    shortDescription: 'Pitch rate feedforward',
    units: '',
    min: 0,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_PIT_FLTD: { shortDescription: 'Pitch rate D-term filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_PIT_FLTT: { shortDescription: 'Pitch rate target filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_PIT_IMAX: { shortDescription: 'Pitch rate I-term maximum', units: '', min: 0, max: 1 },

  // PID Tuning — Yaw Rate
  ATC_RAT_YAW_P: {
    shortDescription: 'Yaw rate P gain',
    units: '',
    min: 0.001,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_YAW_I: {
    shortDescription: 'Yaw rate I gain',
    units: '',
    min: 0,
    max: 2,
    increment: 0.01
  },
  ATC_RAT_YAW_D: {
    shortDescription: 'Yaw rate D gain',
    units: '',
    min: 0,
    max: 0.05,
    increment: 0.0001
  },
  ATC_RAT_YAW_FF: {
    shortDescription: 'Yaw rate feedforward',
    units: '',
    min: 0,
    max: 0.5,
    increment: 0.001
  },
  ATC_RAT_YAW_FLTD: { shortDescription: 'Yaw rate D-term filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_YAW_FLTT: { shortDescription: 'Yaw rate target filter', units: 'Hz', min: 0, max: 200 },
  ATC_RAT_YAW_IMAX: { shortDescription: 'Yaw rate I-term maximum', units: '', min: 0, max: 1 },

  // Position/Velocity controllers
  PSC_POSXY_P: {
    shortDescription: 'Position XY P gain',
    units: '',
    min: 0.5,
    max: 2,
    increment: 0.1
  },
  PSC_VELXY_P: {
    shortDescription: 'Velocity XY P gain',
    units: '',
    min: 0.1,
    max: 6,
    increment: 0.1
  },
  PSC_VELXY_I: {
    shortDescription: 'Velocity XY I gain',
    units: '',
    min: 0.02,
    max: 1,
    increment: 0.01
  },
  PSC_VELXY_D: {
    shortDescription: 'Velocity XY D gain',
    units: '',
    min: 0,
    max: 1,
    increment: 0.001
  },
  PSC_VELXY_FF: {
    shortDescription: 'Velocity XY feedforward',
    units: '',
    min: 0,
    max: 6,
    increment: 0.01
  },
  PSC_VELXY_IMAX: { shortDescription: 'Velocity XY I maximum', units: 'm/s', min: 0, max: 4500 },
  PSC_VELXY_FLTD: { shortDescription: 'Velocity XY D-term filter', units: 'Hz', min: 0, max: 100 },
  PSC_VELXY_FLTE: { shortDescription: 'Velocity XY error filter', units: 'Hz', min: 0, max: 100 },
  PSC_POSZ_P: { shortDescription: 'Position Z P gain', units: '', min: 1, max: 3, increment: 0.1 },
  PSC_VELZ_P: { shortDescription: 'Velocity Z P gain', units: '', min: 1, max: 8, increment: 0.1 },
  PSC_ACCZ_P: {
    shortDescription: 'Accel Z P gain',
    units: '',
    min: 0.25,
    max: 0.8,
    increment: 0.01
  },
  PSC_ACCZ_I: { shortDescription: 'Accel Z I gain', units: '', min: 0, max: 1.5, increment: 0.01 },
  PSC_ACCZ_D: { shortDescription: 'Accel Z D gain', units: '', min: 0, max: 0.4, increment: 0.001 },
  PSC_ACCZ_FF: {
    shortDescription: 'Accel Z feedforward',
    units: '',
    min: 0,
    max: 0.5,
    increment: 0.01
  },
  PSC_ACCZ_IMAX: { shortDescription: 'Accel Z I maximum', units: 'cm/s/s', min: 0, max: 1000 },
  PSC_ACCZ_FLTD: { shortDescription: 'Accel Z D-term filter', units: 'Hz', min: 0, max: 100 },
  PSC_ACCZ_FLTE: { shortDescription: 'Accel Z error filter', units: 'Hz', min: 0, max: 100 },

  // INS calibration offsets
  INS_ACCOFFS_X: { shortDescription: 'Accel X offset', units: 'm/s/s' },
  INS_ACCOFFS_Y: { shortDescription: 'Accel Y offset', units: 'm/s/s' },
  INS_ACCOFFS_Z: { shortDescription: 'Accel Z offset', units: 'm/s/s' },
  INS_GYROFFS_X: { shortDescription: 'Gyro X offset', units: 'rad/s' },
  INS_GYROFFS_Y: { shortDescription: 'Gyro Y offset', units: 'rad/s' },
  INS_GYROFFS_Z: { shortDescription: 'Gyro Z offset', units: 'rad/s' },
  COMPASS_OFS_X: { shortDescription: 'Compass X offset', units: 'mGauss' },
  COMPASS_OFS_Y: { shortDescription: 'Compass Y offset', units: 'mGauss' },
  COMPASS_OFS_Z: { shortDescription: 'Compass Z offset', units: 'mGauss' }
}

/**
 * Look up metadata for a parameter by name.
 * Returns undefined if no metadata is available.
 */
export function getParameterMetadata(name: string): PartialMeta | undefined {
  return META[name]
}

/**
 * Check if a parameter value is within its valid range.
 * Returns null if valid or no range defined, or an error message.
 */
export function validateParameterValue(name: string, value: number): string | null {
  const meta = META[name]
  if (!meta) return null
  if (meta.min !== undefined && value < meta.min) {
    return `Below minimum (${meta.min})`
  }
  if (meta.max !== undefined && value > meta.max) {
    return `Above maximum (${meta.max})`
  }
  return null
}
