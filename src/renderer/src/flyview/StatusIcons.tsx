import { useState, useRef, useEffect } from 'react'
import { useTelemetry, useConnected } from '../hooks/useVehicle'
import styles from './StatusIcons.module.css'

import { GPS_FIX_NAMES } from '../lib/gps'

/* ── GPS ─────────────────────────────────────────── */

function GpsConnectivityIcon({
  color,
  connected,
  size = 28
}: {
  color: string
  connected: boolean
  size?: number
}): React.JSX.Element {
  const pinColor = color
  const signalColor = connected ? '#10B981' : '#94A3B8'

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {connected && (
        <>
          <path
            d="M32 12 Q 20 12 20 24"
            stroke={signalColor}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.6"
          />
          <path
            d="M32 12 Q 44 12 44 24"
            stroke={signalColor}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.6"
          />
          <path
            d="M32 8 Q 16 8 16 28"
            stroke={signalColor}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.3"
          />
          <path
            d="M32 8 Q 48 8 48 28"
            stroke={signalColor}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.3"
          />
        </>
      )}
      {!connected && (
        <>
          <line
            x1="22"
            y1="18"
            x2="30"
            y2="26"
            stroke={pinColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1="30"
            y1="18"
            x2="22"
            y2="26"
            stroke={pinColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1="34"
            y1="18"
            x2="42"
            y2="26"
            stroke={pinColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1="42"
            y1="18"
            x2="34"
            y2="26"
            stroke={pinColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}
      <path
        d="M32 20C26.4772 20 22 24.4772 22 30C22 35.5228 32 52 32 52C32 52 42 35.5228 42 30C42 24.4772 37.5228 20 32 20Z"
        fill={pinColor}
        stroke={pinColor}
        strokeWidth="1.5"
      />
      <circle cx="32" cy="30" r="4" fill="white" />
    </svg>
  )
}

function GpsIcon(): React.JSX.Element {
  const core = useTelemetry('core')
  const gpsRaw = useTelemetry('gpsRaw')
  const commLost = !core || core.communicationLost

  const fixType = commLost ? undefined : gpsRaw?.fixType
  const hasFix = fixType != null && fixType >= 2
  const hasData = fixType != null && fixType > 0
  const color = hasFix ? '#10B981' : hasData ? '#EF4444' : '#94A3B8'
  const fixName = hasData ? (GPS_FIX_NAMES[fixType] ?? `Fix ${fixType}`) : 'No Data'
  const sats = commLost ? undefined : gpsRaw?.satelliteCount
  const hdop = commLost ? undefined : gpsRaw?.hdop

  return (
    <div className={styles.icon}>
      <GpsConnectivityIcon color={color} connected={hasFix} />
      <div className={styles.tooltip}>
        <div className={styles.tipRow}>
          <span className={styles.tipLabel}>Fix</span>
          <span className={styles.tipValue} style={{ color }}>
            {fixName}
          </span>
        </div>
        <div className={styles.tipRow}>
          <span className={styles.tipLabel}>Sats</span>
          <span className={styles.tipValue}>{sats ?? '--'}</span>
        </div>
        <div className={styles.tipRow}>
          <span className={styles.tipLabel}>HDOP</span>
          <span
            className={styles.tipValue}
            style={{ color: hdop != null && hdop < 2 ? '#10B981' : '#F59E0B' }}
          >
            {hdop?.toFixed(1) ?? '--'}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Battery ─────────────────────────────────────── */

function BatteryIconSvg({
  charge,
  size = 28
}: {
  charge: number
  size?: number
}): React.JSX.Element {
  const clampedCharge = Math.max(0, Math.min(100, charge))
  const color = clampedCharge <= 20 ? '#EF4444' : clampedCharge <= 50 ? '#F59E0B' : '#10B981'
  const fillWidth = (clampedCharge / 100) * 18

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect
        x="4"
        y="10"
        width="22"
        height="12"
        rx="2"
        stroke="#94A3B8"
        strokeWidth="1.5"
        fill="none"
      />
      <rect x="26" y="14" width="2" height="4" rx="1" fill="#94A3B8" />
      <rect x="6" y="12" width={fillWidth} height="8" rx="1" fill={color} />
      {clampedCharge <= 20 && (
        <text
          x="15"
          y="18"
          fontSize="12"
          fill="white"
          textAnchor="middle"
          dominantBaseline="middle"
          fontWeight="bold"
        >
          !
        </text>
      )}
    </svg>
  )
}

function BatteryIcon(): React.JSX.Element | null {
  const core = useTelemetry('core')
  const battery = useTelemetry('battery')
  const commLost = !core || core.communicationLost

  const bat = commLost ? undefined : battery?.batteries[0]
  if (!bat) return null

  const color = bat.remaining <= 20 ? '#EF4444' : bat.remaining <= 50 ? '#F59E0B' : '#10B981'

  return (
    <div className={styles.icon}>
      <BatteryIconSvg charge={bat.remaining} />
      <span className={styles.batteryPct} style={{ color }}>
        {bat.remaining}%
      </span>
      <div className={styles.tooltip}>
        {battery!.batteries.map((b) => (
          <div key={b.id}>
            {battery!.batteries.length > 1 && (
              <div className={styles.tipRow}>
                <span className={styles.tipLabel}>Battery</span>
                <span className={styles.tipValue}>#{b.id}</span>
              </div>
            )}
            <div className={styles.tipRow}>
              <span className={styles.tipLabel}>Charge</span>
              <span
                className={styles.tipValue}
                style={{
                  color: b.remaining <= 20 ? '#EF4444' : b.remaining <= 50 ? '#F59E0B' : '#10B981'
                }}
              >
                {b.remaining}%
              </span>
            </div>
            <div className={styles.tipRow}>
              <span className={styles.tipLabel}>Voltage</span>
              <span className={styles.tipValue}>{b.voltage.toFixed(1)} V</span>
            </div>
            <div className={styles.tipRow}>
              <span className={styles.tipLabel}>Current</span>
              <span className={styles.tipValue}>{b.current.toFixed(1)} A</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Connection indicator ─────────────────────────── */

// Core sensors that reliably report health in SYS_STATUS (MAV_SYS_STATUS_SENSOR).
// MAG (bit 2) and BARO (bit 3) are excluded — PX4 SIH doesn't set their health bits.
const CALIBRATION_SENSORS =
  (1 << 0) | // GYRO
  (1 << 1) | // ACCEL
  (1 << 5) | // GPS
  (1 << 21) // AHRS

interface Check {
  label: string
  ok: boolean
  detail: string
}

function ConnectionIndicator(): React.JSX.Element {
  const connected = useConnected()
  const core = useTelemetry('core')
  const sysStatus = useTelemetry('sysStatus')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const enabledCal = sysStatus ? sysStatus.onboardControlSensorsEnabled & CALIBRATION_SENSORS : 0
  const healthyCal = sysStatus ? sysStatus.onboardControlSensorsHealth & CALIBRATION_SENSORS : 0
  const calOk = sysStatus != null && (healthyCal & enabledCal) === enabledCal

  const commOk = connected && core != null && !core.communicationLost

  const checks: Check[] = [
    {
      label: 'Link',
      ok: commOk,
      detail: commOk ? 'Connected' : 'No vehicle'
    },
    {
      label: 'Heartbeat',
      ok: commOk,
      detail: commOk ? (core!.armed ? 'Armed' : 'Disarmed') : 'No heartbeat'
    },
    {
      label: 'Calibration',
      ok: !commOk || calOk,
      detail: !commOk ? 'No data' : calOk ? 'Sensors calibrated' : 'Needs calibration'
    }
  ]

  const allOk = checks.every((c) => c.ok)
  const color = allOk ? '#10B981' : '#EF4444'

  return (
    <div className={styles.connIcon} ref={ref} onClick={() => setOpen((v) => !v)}>
      <div
        className={styles.connDot}
        style={{
          background: color,
          boxShadow: `0 0 6px ${color}80`
        }}
      />
      <div className={`${styles.connPanel} ${open ? styles.connPanelOpen : ''}`}>
        {checks.map((c) => (
          <div key={c.label} className={styles.connRow}>
            <div
              className={styles.connRowDot}
              style={{ background: c.ok ? '#10B981' : '#EF4444' }}
            />
            <span className={styles.connRowLabel}>{c.label}</span>
            <span className={styles.connRowValue} style={{ color: c.ok ? '#10B981' : '#EF4444' }}>
              {c.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Combined strip ──────────────────────────────── */

export function StatusIcons(): React.JSX.Element {
  return (
    <div className={styles.root}>
      <ConnectionIndicator />
      <div className={styles.separator} />
      <GpsIcon />
      <div className={styles.separator} />
      <BatteryIcon />
    </div>
  )
}
