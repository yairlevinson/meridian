import { useState, useCallback, useMemo } from 'react'
import { useCalibration } from '../../hooks/useCalibration'
import { useSetupStore } from '../../store/setupStore'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { CalibrationSensor, CalibrationStatus } from '../../../../shared-types/ipc/SetupTypes'
import { CalibrationWizard } from './CalibrationWizard'
import styles from './SensorCalibrationPage.module.css'

const MAV_AUTOPILOT_PX4 = 12

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

/** Parameters that indicate a sensor has been calibrated (ArduPilot + PX4) */
const CAL_STATUS_PARAMS: Array<{
  sensor: CalibrationSensor
  params: string[]
  label: string
}> = [
  {
    sensor: CalibrationSensor.Accel,
    params: ['INS_ACCOFFS_X', 'CAL_ACC0_ID'],
    label: 'Accelerometer'
  },
  { sensor: CalibrationSensor.Compass, params: ['COMPASS_OFS_X', 'CAL_MAG0_ID'], label: 'Compass' },
  { sensor: CalibrationSensor.Gyro, params: ['INS_GYROFFS_X', 'CAL_GYRO0_ID'], label: 'Gyroscope' }
]

interface CalButton {
  sensor: CalibrationSensor
  label: string
  description: string
}

/** PX4 calibration buttons (matching QGroundControl) */
const PX4_BUTTONS: CalButton[] = [
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
    sensor: CalibrationSensor.Accel,
    label: 'Accelerometer',
    description: '6-side calibration — position vehicle on each side'
  },
  {
    sensor: CalibrationSensor.LevelHorizon,
    label: 'Level Horizon',
    description: 'Hold vehicle in level flight position'
  },
  {
    sensor: CalibrationSensor.Airspeed,
    label: 'Airspeed',
    description: 'Keep airspeed sensor out of wind, then blow across it'
  }
]

/** ArduPilot calibration buttons */
const ARDUPILOT_BUTTONS: CalButton[] = [
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
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicles = useVehicleStore((s) => s.vehicles)
  const core = activeVehicleId ? vehicles[activeVehicleId]?.core : undefined
  const autopilot = core?.autopilot
  const isPX4 = autopilot === MAV_AUTOPILOT_PX4
  const vehicleType = core?.vehicleType ?? 0

  // Airspeed only relevant for fixed-wing (1), airship (7), VTOL (19-25) — matching QGC
  const hasAirspeed =
    vehicleType === 1 || vehicleType === 7 || (vehicleType >= 19 && vehicleType <= 25)

  const calibrationButtons = useMemo(() => {
    const buttons = isPX4 ? PX4_BUTTONS : ARDUPILOT_BUTTONS
    return hasAirspeed ? buttons : buttons.filter((b) => b.sensor !== CalibrationSensor.Airspeed)
  }, [isPX4, hasAirspeed])

  const isCalibrating =
    calibrationState !== null &&
    calibrationState.status !== CalibrationStatus.Idle &&
    calibrationState.status !== CalibrationStatus.Complete &&
    calibrationState.status !== CalibrationStatus.Failed &&
    calibrationState.status !== CalibrationStatus.Cancelled

  // Show wizard when calibrating or when showing results
  const showWizard = calibrationState !== null && calibrationState.status !== CalibrationStatus.Idle

  // Board orientation parameter: PX4 uses SENS_BOARD_ROT, ArduPilot uses AHRS_ORIENTATION
  const orientationParam = isPX4 ? 'SENS_BOARD_ROT' : 'AHRS_ORIENTATION'
  const savedOrientation = parameters.get(orientationParam)?.value ?? 0
  const [orientation, setOrientation] = useState(savedOrientation)
  const [orientationDirty, setOrientationDirty] = useState(false)

  // Calibration status indicators based on parameter values
  const calStatuses = useMemo(() => {
    if (!loadState.parametersReady) return new Map<CalibrationSensor, boolean>()
    const map = new Map<CalibrationSensor, boolean>()
    for (const { sensor, params } of CAL_STATUS_PARAMS) {
      // Check both ArduPilot and PX4 param names — a non-zero value means calibrated
      const calibrated = params.some((name) => {
        const p = parameters.get(name)
        return p !== undefined && p.value !== 0
      })
      map.set(sensor, calibrated)
    }
    // Level Horizon has no reliable parameter — QGC always shows it as green
    map.set(CalibrationSensor.LevelHorizon, true)
    return map
  }, [parameters, loadState.parametersReady])

  const handleOrientationSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    await bridge.setParameter(1, orientationParam, orientation)
    setOrientationDirty(false)
  }, [orientation, orientationParam])

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
        <span className={styles.orientationParamName}>{orientationParam}</span>
      </div>

      <div className={styles.grid}>
        {calibrationButtons.map((btn) => {
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
