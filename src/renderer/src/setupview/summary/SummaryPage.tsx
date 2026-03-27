import { useMemo } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useParameterStore } from '../../store/parameterStore'
import styles from './SummaryPage.module.css'

/** MAV_SYS_STATUS_SENSOR bitmask values for ArduPilot */
const SENSOR_BITS = {
  GYRO_3D: 1 << 0,
  ACCEL_3D: 1 << 1,
  MAG_3D: 1 << 2,
  ABSOLUTE_PRESSURE: 1 << 3,
  GPS: 1 << 5,
  OPTICAL_FLOW: 1 << 7,
  RC_RECEIVER: 1 << 10,
  AHRS: 1 << 21,
  BATTERY: 1 << 26,
  PRE_ARM_CHECK: 1 << 28
} as const

interface SensorStatus {
  label: string
  bit: number
  present: boolean
  enabled: boolean
  healthy: boolean
}

function getSensorStatuses(
  present: number,
  enabled: number,
  health: number
): SensorStatus[] {
  return [
    { label: 'Gyroscope', bit: SENSOR_BITS.GYRO_3D },
    { label: 'Accelerometer', bit: SENSOR_BITS.ACCEL_3D },
    { label: 'Compass', bit: SENSOR_BITS.MAG_3D },
    { label: 'Barometer', bit: SENSOR_BITS.ABSOLUTE_PRESSURE },
    { label: 'GPS', bit: SENSOR_BITS.GPS },
    { label: 'RC Receiver', bit: SENSOR_BITS.RC_RECEIVER },
    { label: 'AHRS', bit: SENSOR_BITS.AHRS },
    { label: 'Battery', bit: SENSOR_BITS.BATTERY },
    { label: 'Pre-Arm Check', bit: SENSOR_BITS.PRE_ARM_CHECK }
  ].map((s) => ({
    ...s,
    present: (present & s.bit) !== 0,
    enabled: (enabled & s.bit) !== 0,
    healthy: (health & s.bit) !== 0
  }))
}

function statusIcon(s: SensorStatus): string {
  if (!s.present) return '-'
  if (!s.enabled) return '-'
  return s.healthy ? 'OK' : 'FAIL'
}

function statusClass(s: SensorStatus, css: Record<string, string>): string {
  if (!s.present || !s.enabled) return css.statusNA!
  return s.healthy ? css.statusOK! : css.statusFail!
}

export function SummaryPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicle = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid] : undefined
  })
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)

  const core = vehicle?.core
  const sysStatus = vehicle?.sysStatus
  const battery = vehicle?.battery
  const gpsRaw = vehicle?.gpsRaw

  const sensors = useMemo(() => {
    if (!sysStatus) return []
    return getSensorStatuses(
      sysStatus.onboardControlSensorsPresent,
      sysStatus.onboardControlSensorsEnabled,
      sysStatus.onboardControlSensorsHealth
    )
  }, [sysStatus])

  // Parameter-based checks
  const paramChecks = useMemo(() => {
    const checks: Array<{ label: string; status: 'ok' | 'warn' | 'na'; detail: string }> = []

    if (!loadState.parametersReady) {
      return [{ label: 'Parameters', status: 'na' as const, detail: 'Not loaded' }]
    }

    // Flight modes configured?
    const fltmode1 = parameters.get('FLTMODE1')
    checks.push({
      label: 'Flight Modes',
      status: fltmode1 ? 'ok' : 'warn',
      detail: fltmode1 ? `Mode 1: ${fltmode1.value}` : 'Not configured'
    })

    // Battery monitoring
    const battMon = parameters.get('BATT_MONITOR')
    checks.push({
      label: 'Battery Monitor',
      status: battMon && battMon.value > 0 ? 'ok' : 'warn',
      detail: battMon ? (battMon.value > 0 ? 'Enabled' : 'Disabled') : 'Not set'
    })

    // Failsafe
    const fsThr = parameters.get('FS_THR_ENABLE')
    checks.push({
      label: 'Throttle Failsafe',
      status: fsThr && fsThr.value > 0 ? 'ok' : 'warn',
      detail: fsThr ? (fsThr.value > 0 ? 'Enabled' : 'Disabled') : 'Not set'
    })

    // Fence
    const fence = parameters.get('FENCE_ENABLE')
    checks.push({
      label: 'Geofence',
      status: fence && fence.value > 0 ? 'ok' : 'warn',
      detail: fence ? (fence.value > 0 ? 'Enabled' : 'Disabled') : 'Not set'
    })

    // Calibration completion checks
    const accelOfs = parameters.get('INS_ACCOFFS_X')
    checks.push({
      label: 'Accel Calibration',
      status: accelOfs && accelOfs.value !== 0 ? 'ok' : 'warn',
      detail: accelOfs && accelOfs.value !== 0 ? 'Done' : 'Not calibrated'
    })

    const compassOfs = parameters.get('COMPASS_OFS_X')
    checks.push({
      label: 'Compass Calibration',
      status: compassOfs && compassOfs.value !== 0 ? 'ok' : 'warn',
      detail: compassOfs && compassOfs.value !== 0 ? 'Done' : 'Not calibrated'
    })

    const gyroOfs = parameters.get('INS_GYROFFS_X')
    checks.push({
      label: 'Gyro Calibration',
      status: gyroOfs && gyroOfs.value !== 0 ? 'ok' : 'warn',
      detail: gyroOfs && gyroOfs.value !== 0 ? 'Done' : 'Not calibrated'
    })

    // RC calibration check
    const rc1Min = parameters.get('RC1_MIN')
    const rcCalibrated = rc1Min && rc1Min.value !== 1100 // 1100 is default uncalibrated
    checks.push({
      label: 'RC Calibration',
      status: rcCalibrated ? 'ok' : 'warn',
      detail: rcCalibrated ? 'Done' : 'Not calibrated'
    })

    return checks
  }, [parameters, loadState.parametersReady])

  if (activeVehicleId === null) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Vehicle Summary</div>
        <div className={styles.noVehicle}>No vehicle connected</div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Vehicle Summary</div>

      {/* Vehicle info */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Vehicle</div>
        <div className={styles.infoGrid}>
          <span className={styles.infoLabel}>System ID</span>
          <span className={styles.infoValue}>{core?.sysid ?? '-'}</span>
          <span className={styles.infoLabel}>Firmware</span>
          <span className={styles.infoValue}>
            {core ? `${core.firmwareVersionMajor}.${core.firmwareVersionMinor}.${core.firmwareVersionPatch}` : 'Unknown'}
          </span>
          <span className={styles.infoLabel}>Armed</span>
          <span className={styles.infoValue}>{core?.armed ? 'YES' : 'NO'}</span>
          <span className={styles.infoLabel}>Flight Mode</span>
          <span className={styles.infoValue}>{core?.flightMode ?? '-'}</span>
        </div>
      </div>

      {/* GPS */}
      {gpsRaw && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>GPS</div>
          <div className={styles.infoGrid}>
            <span className={styles.infoLabel}>Fix Type</span>
            <span className={styles.infoValue}>{gpsRaw.fixType}</span>
            <span className={styles.infoLabel}>Satellites</span>
            <span className={styles.infoValue}>{gpsRaw.satelliteCount}</span>
            <span className={styles.infoLabel}>HDOP</span>
            <span className={styles.infoValue}>{(gpsRaw.hdop / 100).toFixed(1)}</span>
          </div>
        </div>
      )}

      {/* Battery */}
      {battery && battery.batteries.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Battery</div>
          {battery.batteries.map((b) => (
            <div key={b.id} className={styles.infoGrid}>
              <span className={styles.infoLabel}>Battery {b.id}</span>
              <span className={styles.infoValue}>
                {b.voltage.toFixed(1)}V / {b.remaining >= 0 ? `${b.remaining}%` : '--'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sensor health */}
      {sensors.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Sensor Health</div>
          <div className={styles.sensorGrid}>
            {sensors
              .filter((s) => s.present)
              .map((s) => (
                <div key={s.label} className={styles.sensorRow}>
                  <span className={styles.sensorLabel}>{s.label}</span>
                  <span className={`${styles.sensorStatus} ${statusClass(s, styles)}`}>
                    {statusIcon(s)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Parameter-based checks */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Configuration</div>
        <div className={styles.sensorGrid}>
          {paramChecks.map((c) => (
            <div key={c.label} className={styles.sensorRow}>
              <span className={styles.sensorLabel}>{c.label}</span>
              <span
                className={`${styles.sensorStatus} ${
                  c.status === 'ok'
                    ? styles.statusOK
                    : c.status === 'warn'
                      ? styles.statusWarn
                      : styles.statusNA
                }`}
              >
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
