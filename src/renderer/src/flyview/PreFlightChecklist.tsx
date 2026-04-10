import { useMemo } from 'react'
import { useTelemetry } from '../hooks/useVehicle'
import styles from './PreFlightChecklist.module.css'

// ── Sensor health bitmask constants (MAV_SYS_STATUS_SENSOR) ──
const SENSOR_3D_GYRO = 1 << 0
const SENSOR_3D_ACCEL = 1 << 1
const SENSOR_3D_MAG = 1 << 2
const SENSOR_ABSOLUTE_PRESSURE = 1 << 3
const SENSOR_GPS = 1 << 5
const SENSOR_AHRS = 1 << 21

const CHECKED_SENSORS =
  SENSOR_3D_GYRO |
  SENSOR_3D_ACCEL |
  SENSOR_3D_MAG |
  SENSOR_ABSOLUTE_PRESSURE |
  SENSOR_GPS |
  SENSOR_AHRS

// ── Thresholds ──
const MIN_GPS_FIX = 3 // 3D fix
const MIN_SATELLITES = 9
const MIN_BATTERY_PERCENT = 40

type CheckStatus = 'pending' | 'passed' | 'failed'

interface CheckItem {
  id: string
  label: string
  status: CheckStatus
  message?: string
}

function useTelemetryChecks(): CheckItem[] {
  const core = useTelemetry('core')
  const gpsRaw = useTelemetry('gpsRaw')
  const battery = useTelemetry('battery')
  const sysStatus = useTelemetry('sysStatus')
  const rc = useTelemetry('rc')

  return useMemo(() => {
    const checks: CheckItem[] = []

    // GPS lock
    const hasFix = (gpsRaw?.fixType ?? 0) >= MIN_GPS_FIX
    const satCount = gpsRaw?.satelliteCount ?? 0
    const gpsOk = hasFix && satCount >= MIN_SATELLITES
    checks.push({
      id: 'gps',
      label: 'GPS Lock',
      status: gpsRaw ? (gpsOk ? 'passed' : 'failed') : 'pending',
      message: gpsRaw
        ? gpsOk
          ? `3D fix, ${satCount} sats`
          : `Fix: ${gpsRaw.fixType}, Sats: ${satCount} (need ${MIN_SATELLITES}+)`
        : 'Waiting for GPS data'
    })

    // Battery
    const bat = battery?.batteries?.[0]
    const batOk = bat != null && bat.remaining >= MIN_BATTERY_PERCENT
    checks.push({
      id: 'battery',
      label: 'Battery',
      status: bat != null ? (batOk ? 'passed' : 'failed') : 'pending',
      message:
        bat != null
          ? batOk
            ? `${bat.remaining}% (${bat.voltage.toFixed(1)}V)`
            : `${bat.remaining}% — below ${MIN_BATTERY_PERCENT}%`
          : 'Waiting for battery data'
    })

    // Sensor health
    const enabled = sysStatus?.onboardControlSensorsEnabled ?? 0
    const health = sysStatus?.onboardControlSensorsHealth ?? 0
    const relevantEnabled = enabled & CHECKED_SENSORS
    const unhealthy = relevantEnabled & ~health
    const sensorsOk = sysStatus != null && unhealthy === 0
    const unhealthyNames: string[] = []
    if (unhealthy & SENSOR_3D_GYRO) unhealthyNames.push('Gyro')
    if (unhealthy & SENSOR_3D_ACCEL) unhealthyNames.push('Accel')
    if (unhealthy & SENSOR_3D_MAG) unhealthyNames.push('Mag')
    if (unhealthy & SENSOR_ABSOLUTE_PRESSURE) unhealthyNames.push('Baro')
    if (unhealthy & SENSOR_GPS) unhealthyNames.push('GPS')
    if (unhealthy & SENSOR_AHRS) unhealthyNames.push('AHRS')
    checks.push({
      id: 'sensors',
      label: 'Sensors',
      status: sysStatus ? (sensorsOk ? 'passed' : 'failed') : 'pending',
      message: sysStatus
        ? sensorsOk
          ? 'All sensors healthy'
          : `Unhealthy: ${unhealthyNames.join(', ')}`
        : 'Waiting for sensor data'
    })

    // Communication
    const commOk = core != null && !core.communicationLost
    checks.push({
      id: 'comms',
      label: 'Communication',
      status: core ? (commOk ? 'passed' : 'failed') : 'pending',
      message: core ? (commOk ? 'Link active' : 'Communication lost') : 'Waiting for heartbeat'
    })

    // RC input
    const rcOk = rc != null && rc.channelCount > 0 && rc.channels.some((ch) => ch > 0)
    checks.push({
      id: 'rc',
      label: 'RC Input',
      status: rc ? (rcOk ? 'passed' : 'failed') : 'pending',
      message: rc
        ? rcOk
          ? `${rc.channelCount} channels`
          : 'No RC input detected'
        : 'Waiting for RC data'
    })

    return checks
  }, [core, gpsRaw, battery, sysStatus, rc])
}

export function PreFlightChecklist({
  onComplete
}: {
  onComplete: (passed: boolean) => void
}): React.JSX.Element {
  const checks = useTelemetryChecks()

  const passedCount = checks.filter((c) => c.status === 'passed').length
  const failedCount = checks.filter((c) => c.status === 'failed').length
  const totalCount = checks.length
  const allPassed = passedCount === totalCount

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Pre-Flight Checklist</span>
        <span className={styles.summary}>
          {passedCount}/{totalCount}
          {failedCount > 0 && <span className={styles.failBadge}>{failedCount} failed</span>}
        </span>
      </div>

      <div className={styles.items}>
        {checks.map((item) => (
          <div key={item.id} className={`${styles.item} ${styles[item.status]}`}>
            <span className={styles.indicator}>
              {item.status === 'passed' ? '\u2713' : item.status === 'failed' ? '\u2717' : '\u2022'}
            </span>
            <div className={styles.itemContent}>
              <span className={styles.itemLabel}>{item.label}</span>
              {item.message && <span className={styles.itemMessage}>{item.message}</span>}
            </div>
          </div>
        ))}
      </div>

      <button
        className={`${styles.armBtn} ${allPassed ? styles.armReady : ''}`}
        disabled={!allPassed}
        onClick={() => onComplete(true)}
      >
        {allPassed ? 'Ready to Arm' : `${totalCount - passedCount} checks remaining`}
      </button>
    </div>
  )
}
