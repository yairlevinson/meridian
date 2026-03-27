import { useState, useCallback, useMemo } from 'react'
import { useCalibration } from '../../hooks/useCalibration'
import { useSetupStore } from '../../store/setupStore'
import { useParameterStore } from '../../store/parameterStore'
import {
  CalibrationSensor,
  CalibrationStatus
} from '../../../../shared-types/ipc/SetupTypes'
import { CalibrationWizard } from './CalibrationWizard'
import styles from './SensorCalibrationPage.module.css'

/** ArduPilot AHRS_ORIENTATION values (MAV_SENSOR_ROTATION subset) */
const BOARD_ORIENTATIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Yaw 45' },
  { value: 2, label: 'Yaw 90' },
  { value: 3, label: 'Yaw 135' },
  { value: 4, label: 'Yaw 180' },
  { value: 5, label: 'Yaw 225' },
  { value: 6, label: 'Yaw 270' },
  { value: 7, label: 'Yaw 315' },
  { value: 8, label: 'Roll 180' },
  { value: 9, label: 'Roll 180, Yaw 45' },
  { value: 10, label: 'Roll 180, Yaw 90' },
  { value: 11, label: 'Roll 180, Yaw 135' },
  { value: 12, label: 'Pitch 180' },
  { value: 13, label: 'Roll 180, Yaw 225' },
  { value: 14, label: 'Roll 180, Yaw 270' },
  { value: 15, label: 'Roll 180, Yaw 315' },
  { value: 16, label: 'Roll 90' },
  { value: 17, label: 'Roll 90, Yaw 45' },
  { value: 18, label: 'Roll 90, Yaw 90' },
  { value: 19, label: 'Roll 90, Yaw 135' },
  { value: 20, label: 'Roll 270' },
  { value: 21, label: 'Roll 270, Yaw 45' },
  { value: 22, label: 'Roll 270, Yaw 90' },
  { value: 23, label: 'Roll 270, Yaw 135' },
  { value: 24, label: 'Pitch 90' },
  { value: 25, label: 'Pitch 270' },
  { value: 26, label: 'Pitch 180, Yaw 90' },
  { value: 27, label: 'Pitch 180, Yaw 270' },
  { value: 28, label: 'Roll 90, Pitch 90' },
  { value: 29, label: 'Roll 180, Pitch 90' },
  { value: 30, label: 'Roll 270, Pitch 90' },
  { value: 31, label: 'Roll 90, Pitch 180' },
  { value: 32, label: 'Roll 270, Pitch 180' },
  { value: 33, label: 'Roll 90, Pitch 270' },
  { value: 34, label: 'Roll 180, Pitch 270' },
  { value: 35, label: 'Roll 270, Pitch 270' },
  { value: 36, label: 'Roll 90, Pitch 180, Yaw 90' },
  { value: 37, label: 'Roll 90, Yaw 270' },
  { value: 38, label: 'Roll 90, Pitch 68, Yaw 293' },
  { value: 39, label: 'Pitch 315' },
  { value: 40, label: 'Roll 90, Pitch 315' },
  { value: 42, label: 'Pitch 7' }
]

/** Parameters that indicate a sensor has been calibrated */
const CAL_STATUS_PARAMS: Array<{
  sensor: CalibrationSensor
  param: string
  label: string
}> = [
  { sensor: CalibrationSensor.Accel, param: 'INS_ACCOFFS_X', label: 'Accelerometer' },
  { sensor: CalibrationSensor.Compass, param: 'COMPASS_OFS_X', label: 'Compass' },
  { sensor: CalibrationSensor.Gyro, param: 'INS_GYROFFS_X', label: 'Gyroscope' }
]

const CALIBRATION_BUTTONS: Array<{
  sensor: CalibrationSensor
  label: string
  description: string
}> = [
  {
    sensor: CalibrationSensor.Accel,
    label: 'Accelerometer',
    description: '6-side calibration — position vehicle on each side'
  },
  {
    sensor: CalibrationSensor.AccelSimple,
    label: 'Simple Accel',
    description: 'Quick calibration — hold vehicle level'
  },
  {
    sensor: CalibrationSensor.Compass,
    label: 'Compass',
    description: 'Rotate vehicle in all directions'
  },
  {
    sensor: CalibrationSensor.Gyro,
    label: 'Gyroscope',
    description: 'Keep vehicle still on a flat surface'
  },
  {
    sensor: CalibrationSensor.LevelHorizon,
    label: 'Level Horizon',
    description: 'Hold vehicle in level flight position'
  },
  {
    sensor: CalibrationSensor.Pressure,
    label: 'Pressure',
    description: 'Ground pressure / airspeed calibration'
  },
  {
    sensor: CalibrationSensor.Esc,
    label: 'ESC',
    description: 'ESC calibration — follow on-screen instructions'
  }
]

export function SensorCalibrationPage(): React.JSX.Element {
  const { calibrationState, startCalibration, cancelCalibration } = useCalibration()
  const setCalibrationState = useSetupStore((s) => s.setCalibrationState)
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)

  const isCalibrating =
    calibrationState !== null &&
    calibrationState.status !== CalibrationStatus.Idle &&
    calibrationState.status !== CalibrationStatus.Complete &&
    calibrationState.status !== CalibrationStatus.Failed &&
    calibrationState.status !== CalibrationStatus.Cancelled

  // Show wizard when calibrating or when showing results
  const showWizard = calibrationState !== null && calibrationState.status !== CalibrationStatus.Idle

  // Board orientation from AHRS_ORIENTATION parameter
  const savedOrientation = parameters.get('AHRS_ORIENTATION')?.value ?? 0
  const [orientation, setOrientation] = useState(savedOrientation)
  const [orientationDirty, setOrientationDirty] = useState(false)

  // Calibration status indicators based on parameter values
  const calStatuses = useMemo(() => {
    if (!loadState.parametersReady) return new Map<CalibrationSensor, boolean>()
    const map = new Map<CalibrationSensor, boolean>()
    for (const { sensor, param } of CAL_STATUS_PARAMS) {
      const p = parameters.get(param)
      // A non-zero offset value means the sensor has been calibrated
      map.set(sensor, p !== undefined && p.value !== 0)
    }
    return map
  }, [parameters, loadState.parametersReady])

  const handleOrientationSave = useCallback(async () => {
    const bridge = window.qgcBridge
    if (!bridge) return
    await bridge.setParameter(1, 'AHRS_ORIENTATION', orientation)
    setOrientationDirty(false)
  }, [orientation])

  if (showWizard) {
    return (
      <div className={styles.root}>
        <CalibrationWizard
          state={calibrationState}
          onCancel={cancelCalibration}
          onDone={() => setCalibrationState(null)}
        />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Sensor Calibration</div>

      {/* Board orientation selector */}
      <div className={styles.orientationSection}>
        <span className={styles.orientationLabel}>Board Orientation</span>
        <select
          className={styles.orientationSelect}
          value={orientation}
          onChange={(e) => {
            setOrientation(Number(e.target.value))
            setOrientationDirty(true)
          }}
        >
          {BOARD_ORIENTATIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}: {o.label}
            </option>
          ))}
        </select>
        {orientationDirty && (
          <button className={styles.orientationSaveBtn} onClick={handleOrientationSave}>
            Save
          </button>
        )}
        <span className={styles.orientationParamName}>AHRS_ORIENTATION</span>
      </div>

      <div className={styles.grid}>
        {CALIBRATION_BUTTONS.map((btn) => {
          const calibrated = calStatuses.get(btn.sensor)
          return (
            <button
              key={btn.sensor}
              className={`${styles.calBtn} ${calibrated === true ? styles.calBtnCalibrated : calibrated === false ? styles.calBtnNotCalibrated : ''}`}
              disabled={isCalibrating}
              onClick={() => startCalibration(btn.sensor)}
            >
              {calibrated !== undefined && (
                <span className={calibrated ? styles.calStatusOk : styles.calStatusWarn}>
                  {calibrated ? 'Calibrated' : 'Not Calibrated'}
                </span>
              )}
              <span className={styles.calBtnLabel}>{btn.label}</span>
              <span className={styles.calBtnDesc}>{btn.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
