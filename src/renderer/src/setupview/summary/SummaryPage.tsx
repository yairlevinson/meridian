import { useMemo } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useParameterStore } from '../../store/parameterStore'
import { useSetupStore } from '../../store/setupStore'
import type { SetupPage } from '../../../../shared-types/ipc/SetupTypes'
import styles from './SummaryPage.module.css'

const MAV_AUTOPILOT_PX4 = 12

/* ── MAV_TYPE display names ─────────────────── */

const MAV_TYPE_NAMES: Record<number, string> = {
  0: 'Generic',
  1: 'Fixed Wing',
  2: 'Quadrotor',
  3: 'Coaxial',
  4: 'Helicopter',
  10: 'Ground Rover',
  11: 'Surface Boat',
  12: 'Submarine',
  13: 'Hexarotor',
  14: 'Octorotor',
  15: 'Tricopter',
  19: 'VTOL Tiltrotor',
  20: 'VTOL Tailsitter Duo',
  21: 'VTOL Tailsitter Quad',
  22: 'VTOL Tiltrotor',
  23: 'VTOL Fixedrotor',
  24: 'VTOL Tailsitter',
  25: 'VTOL Tiltwing'
}

const AUTOPILOT_NAMES: Record<number, string> = {
  3: 'ArduPilot',
  12: 'PX4'
}

/* ── GPS fix type ───────────────────────────── */

const GPS_FIX_NAMES: Record<number, string> = {
  0: 'No GPS',
  1: 'No Fix',
  2: '2D Fix',
  3: '3D Fix',
  4: 'DGPS',
  5: 'RTK Float',
  6: 'RTK Fixed'
}

function gpsFixColor(fixType: number): string {
  if (fixType >= 5) return 'green'
  if (fixType >= 3) return 'blue'
  if (fixType >= 2) return 'yellow'
  return 'red'
}

/* ── Sensor bitmask ─────────────────────────── */

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

function getSensorStatuses(present: number, enabled: number, health: number): SensorStatus[] {
  return [
    { label: 'Gyroscope', bit: SENSOR_BITS.GYRO_3D },
    { label: 'Accelerometer', bit: SENSOR_BITS.ACCEL_3D },
    { label: 'Compass', bit: SENSOR_BITS.MAG_3D },
    { label: 'Barometer', bit: SENSOR_BITS.ABSOLUTE_PRESSURE },
    { label: 'GPS', bit: SENSOR_BITS.GPS },
    { label: 'RC Receiver', bit: SENSOR_BITS.RC_RECEIVER },
    { label: 'AHRS', bit: SENSOR_BITS.AHRS },
    { label: 'Battery', bit: SENSOR_BITS.BATTERY },
    { label: 'Pre-Arm', bit: SENSOR_BITS.PRE_ARM_CHECK }
  ].map((s) => ({
    ...s,
    present: (present & s.bit) !== 0,
    enabled: (enabled & s.bit) !== 0,
    healthy: (health & s.bit) !== 0
  }))
}

/* ── Parameter checks ───────────────────────── */

interface Check {
  label: string
  ok: boolean
  detail: string
  page: SetupPage
}

function getChecks(
  parameters: Map<string, { value: number }>,
  parametersReady: boolean,
  isPX4: boolean
): Check[] {
  if (!parametersReady) {
    return [
      { label: 'Parameters', ok: false, detail: 'Loading...', page: 'parameters' as SetupPage }
    ]
  }

  const checks: Check[] = []

  // Calibration checks — PX4 uses device IDs, ArduPilot uses offset values
  if (isPX4) {
    const accId = parameters.get('CAL_ACC0_ID')
    checks.push({
      label: 'Accelerometer',
      ok: !!(accId && accId.value !== 0),
      detail: accId && accId.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
    const magId = parameters.get('CAL_MAG0_ID')
    checks.push({
      label: 'Compass',
      ok: !!(magId && magId.value !== 0),
      detail: magId && magId.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
    const gyroId = parameters.get('CAL_GYRO0_ID')
    checks.push({
      label: 'Gyroscope',
      ok: !!(gyroId && gyroId.value !== 0),
      detail: gyroId && gyroId.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
  } else {
    const accOfs = parameters.get('INS_ACCOFFS_X')
    checks.push({
      label: 'Accelerometer',
      ok: !!(accOfs && accOfs.value !== 0),
      detail: accOfs && accOfs.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
    const magOfs = parameters.get('COMPASS_OFS_X')
    checks.push({
      label: 'Compass',
      ok: !!(magOfs && magOfs.value !== 0),
      detail: magOfs && magOfs.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
    const gyroOfs = parameters.get('INS_GYROFFS_X')
    checks.push({
      label: 'Gyroscope',
      ok: !!(gyroOfs && gyroOfs.value !== 0),
      detail: gyroOfs && gyroOfs.value !== 0 ? 'Calibrated' : 'Not calibrated',
      page: 'sensors'
    })
  }

  // RC calibration
  const rc1Min = parameters.get('RC1_MIN')
  const rcCalibrated = rc1Min && rc1Min.value !== 1100
  checks.push({
    label: 'RC Calibration',
    ok: !!rcCalibrated,
    detail: rcCalibrated ? 'Calibrated' : 'Not calibrated',
    page: 'radio'
  })

  // Flight modes
  if (isPX4) {
    const fltmode = parameters.get('COM_FLTMODE1')
    checks.push({
      label: 'Flight Modes',
      ok: !!(fltmode && fltmode.value >= 0),
      detail: fltmode ? 'Configured' : 'Not configured',
      page: 'flightModes'
    })
  } else {
    const fltmode = parameters.get('FLTMODE1')
    checks.push({
      label: 'Flight Modes',
      ok: !!fltmode,
      detail: fltmode ? 'Configured' : 'Not configured',
      page: 'flightModes'
    })
  }

  // Battery monitoring
  if (isPX4) {
    const batSrc = parameters.get('BAT1_SOURCE')
    checks.push({
      label: 'Battery Monitor',
      ok: !!(batSrc && batSrc.value > 0),
      detail: batSrc && batSrc.value > 0 ? 'Enabled' : 'Not configured',
      page: 'power'
    })
  } else {
    const battMon = parameters.get('BATT_MONITOR')
    checks.push({
      label: 'Battery Monitor',
      ok: !!(battMon && battMon.value > 0),
      detail: battMon && battMon.value > 0 ? 'Enabled' : 'Not configured',
      page: 'power'
    })
  }

  // Failsafe (ArduPilot-specific)
  if (!isPX4) {
    const fsThr = parameters.get('FS_THR_ENABLE')
    checks.push({
      label: 'Throttle Failsafe',
      ok: !!(fsThr && fsThr.value > 0),
      detail: fsThr && fsThr.value > 0 ? 'Enabled' : 'Disabled',
      page: 'safety'
    })

    const fence = parameters.get('FENCE_ENABLE')
    checks.push({
      label: 'Geofence',
      ok: !!(fence && fence.value > 0),
      detail: fence && fence.value > 0 ? 'Enabled' : 'Disabled',
      page: 'safety'
    })
  }

  return checks
}

/* ── Component ──────────────────────────────── */

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
  const isPX4 = core?.autopilot === MAV_AUTOPILOT_PX4

  const sensors = useMemo(() => {
    if (!sysStatus) return []
    return getSensorStatuses(
      sysStatus.onboardControlSensorsPresent,
      sysStatus.onboardControlSensorsEnabled,
      sysStatus.onboardControlSensorsHealth
    )
  }, [sysStatus])

  const presentSensors = useMemo(() => sensors.filter((s) => s.present), [sensors])

  const checks = useMemo(
    () => getChecks(parameters, loadState.parametersReady, isPX4),
    [parameters, loadState.parametersReady, isPX4]
  )

  const setActivePage = useSetupStore((s) => s.setActivePage)
  const nav = (page: SetupPage) => () => setActivePage(page)

  const checksOk = checks.filter((c) => c.ok).length
  const checksTotal = checks.length
  const sensorsHealthy = presentSensors.filter((s) => s.healthy).length
  const sensorsTotal = presentSensors.length

  if (activeVehicleId === null) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Vehicle Summary</div>
        <div className={styles.noVehicle}>No vehicle connected</div>
      </div>
    )
  }

  const vehicleTypeName = MAV_TYPE_NAMES[core?.vehicleType ?? 0] ?? 'Unknown'
  const autopilotName = AUTOPILOT_NAMES[core?.autopilot ?? 0] ?? 'Unknown'
  const firmwareStr = core
    ? `${core.firmwareVersionMajor}.${core.firmwareVersionMinor}.${core.firmwareVersionPatch}`
    : '—'

  return (
    <div className={styles.root}>
      <div className={styles.title}>Vehicle Summary</div>

      {/* ── Hero bar: identity + status ────────── */}
      <div className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.vehicleType}>{vehicleTypeName}</span>
          <span className={styles.heroDivider} />
          <span className={styles.heroMeta}>{autopilotName}</span>
          <span className={styles.heroMeta}>v{firmwareStr}</span>
          <span className={styles.heroMeta}>SysID {core?.sysid ?? '—'}</span>
        </div>
        <div className={styles.heroStatus}>
          <span className={`${styles.badge} ${core?.armed ? styles.badgeRed : styles.badgeGreen}`}>
            {core?.armed ? 'ARMED' : 'DISARMED'}
          </span>
          <span className={`${styles.badge} ${styles.badgeBlue}`}>
            {core?.flightModeName || `Mode ${core?.flightMode ?? '—'}`}
          </span>
        </div>
      </div>

      {/* ── Dashboard cards ────────────────────── */}
      <div className={styles.cardGrid}>
        {/* GPS card */}
        <div className={`${styles.card} ${styles.cardClickable}`} onClick={nav('sensors')}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>GPS</span>
            {gpsRaw && (
              <span
                className={`${styles.badge} ${styles[`badge${gpsFixColor(gpsRaw.fixType).charAt(0).toUpperCase() + gpsFixColor(gpsRaw.fixType).slice(1)}` as keyof typeof styles] ?? styles.badgeRed}`}
              >
                {GPS_FIX_NAMES[gpsRaw.fixType] ?? 'Unknown'}
              </span>
            )}
          </div>
          {gpsRaw ? (
            <div className={styles.cardBody}>
              <div className={styles.metric}>
                <span className={styles.metricValue}>{gpsRaw.satelliteCount}</span>
                <span className={styles.metricLabel}>Satellites</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricValue}>{(gpsRaw.hdop / 100).toFixed(1)}</span>
                <span className={styles.metricLabel}>HDOP</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricValue}>{(gpsRaw.vdop / 100).toFixed(1)}</span>
                <span className={styles.metricLabel}>VDOP</span>
              </div>
            </div>
          ) : (
            <div className={styles.cardEmpty}>No GPS data</div>
          )}
        </div>

        {/* Battery card */}
        <div className={`${styles.card} ${styles.cardClickable}`} onClick={nav('power')}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Battery</span>
          </div>
          {battery && battery.batteries.length > 0 ? (
            <div className={styles.cardBody}>
              {battery.batteries.map((b) => {
                const pct = Math.max(0, Math.min(100, b.remaining))
                const color = pct <= 20 ? 'red' : pct <= 40 ? 'yellow' : 'green'
                return (
                  <div key={b.id} className={styles.batteryRow}>
                    <div className={styles.batteryMain}>
                      <span className={styles.metricValue}>{b.voltage.toFixed(1)}V</span>
                      {b.current > 0 && (
                        <span className={styles.batteryCurrentText}>{b.current.toFixed(1)}A</span>
                      )}
                    </div>
                    {b.remaining >= 0 && (
                      <div className={styles.batteryBarWrap}>
                        <div className={styles.batteryBarTrack}>
                          <div
                            className={`${styles.batteryBarFill} ${styles[`batteryBar_${color}` as keyof typeof styles] ?? ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={styles.batteryPct}>{pct}%</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={styles.cardEmpty}>No battery data</div>
          )}
        </div>

        {/* Sensor health card */}
        <div className={`${styles.card} ${styles.cardClickable}`} onClick={nav('sensors')}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Sensors</span>
            {sensorsTotal > 0 && (
              <span
                className={`${styles.badge} ${sensorsHealthy === sensorsTotal ? styles.badgeGreen : styles.badgeYellow}`}
              >
                {sensorsHealthy}/{sensorsTotal}
              </span>
            )}
          </div>
          {presentSensors.length > 0 ? (
            <div className={styles.checklistGrid}>
              {presentSensors.map((s) => (
                <div key={s.label} className={styles.checkItem}>
                  <span
                    className={`${styles.checkDot} ${s.healthy ? styles.checkDotOk : s.enabled ? styles.checkDotFail : styles.checkDotNA}`}
                  />
                  <span className={styles.checkLabel}>{s.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.cardEmpty}>No sensor data</div>
          )}
        </div>

        {/* Configuration checklist card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Setup</span>
            <span
              className={`${styles.badge} ${checksOk === checksTotal ? styles.badgeGreen : styles.badgeYellow}`}
            >
              {checksOk}/{checksTotal}
            </span>
          </div>
          <div className={styles.checklistGrid}>
            {checks.map((c) => (
              <div
                key={c.label}
                className={`${styles.checkItem} ${styles.checkItemClickable}`}
                onClick={nav(c.page)}
              >
                <span
                  className={`${styles.checkDot} ${c.ok ? styles.checkDotOk : styles.checkDotWarn}`}
                />
                <span className={styles.checkLabel}>{c.label}</span>
                <span
                  className={`${styles.checkDetail} ${c.ok ? styles.checkDetailOk : styles.checkDetailWarn}`}
                >
                  {c.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
