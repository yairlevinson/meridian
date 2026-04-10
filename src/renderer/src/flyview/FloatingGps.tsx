import { useTelemetry } from '../hooks/useVehicle'
import { GPS_FIX_NAMES } from '../lib/gps'
import styles from './FloatingGps.module.css'

function gpsColor(fixType: number | undefined): string {
  if (fixType == null) return '#555'
  if (fixType >= 3) return '#00ff88'
  if (fixType >= 2) return '#ffaa00'
  return '#ff4444'
}

function GpsIcon({
  color,
  fixType
}: {
  color: string
  fixType: number | undefined
}): React.JSX.Element {
  const arcs = fixType == null ? 0 : fixType >= 5 ? 3 : fixType >= 3 ? 2 : fixType >= 2 ? 1 : 0

  return (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
      {/* Base / pedestal */}
      <rect
        x="14"
        y="42"
        width="20"
        height="3"
        rx="1.5"
        stroke={color}
        strokeWidth="2.2"
        fill="none"
        opacity="0.8"
      />
      {/* Stand */}
      <line x1="24" y1="42" x2="24" y2="36" stroke={color} strokeWidth="2.2" opacity="0.8" />
      {/* Dish body — parabolic arc */}
      <path
        d="M8,32 Q10,12 30,8"
        stroke={color}
        strokeWidth="2.2"
        fill="none"
        opacity="0.8"
        strokeLinecap="round"
      />
      {/* Dish surface lines */}
      <path d="M11,28 Q14,16 26,12" stroke={color} strokeWidth="1.2" fill="none" opacity="0.3" />
      <path d="M14,25 Q16,18 24,15" stroke={color} strokeWidth="1.2" fill="none" opacity="0.2" />
      {/* Feed arm */}
      <line
        x1="18"
        y1="34"
        x2="34"
        y2="14"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* Feed head */}
      <circle
        cx="35"
        cy="12"
        r="3.5"
        stroke={color}
        strokeWidth="2"
        fill={color}
        fillOpacity="0.25"
      />
      {/* Signal waves from feed */}
      <path
        d="M40,8 A6,6 0 0,1 40,16"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={arcs >= 1 ? 0.7 : 0.12}
      />
      <path
        d="M43,5 A9.5,9.5 0 0,1 43,19"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
        opacity={arcs >= 2 ? 0.55 : 0.08}
      />
      <path
        d="M46,2 A13,13 0 0,1 46,22"
        stroke={color}
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
        opacity={arcs >= 3 ? 0.4 : 0.05}
      />
    </svg>
  )
}

export function FloatingGps(): React.JSX.Element {
  const gpsRaw = useTelemetry('gpsRaw')

  const fixType = gpsRaw?.fixType
  const color = gpsColor(fixType)
  const fixName = fixType != null ? (GPS_FIX_NAMES[fixType] ?? `Fix ${fixType}`) : 'No Data'
  const sats = gpsRaw?.satelliteCount
  const hdop = gpsRaw?.hdop

  return (
    <div className={styles.root}>
      <GpsIcon color={color} fixType={fixType} />
      {sats != null && (
        <span className={styles.satCount} style={{ color }}>
          {sats}
        </span>
      )}
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
            style={{ color: hdop != null && hdop < 2 ? '#00ff88' : '#ffaa00' }}
          >
            {hdop?.toFixed(1) ?? '--'}
          </span>
        </div>
      </div>
    </div>
  )
}
