import { useTelemetry, useHomePosition } from '../hooks/useVehicle'
import styles from './FloatingInstruments.module.css'

/** Haversine distance in meters */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmt(v: number | undefined, decimals: number): string {
  return v != null ? v.toFixed(decimals) : '--'
}

const COLORS = {
  spd: '#66ccdd',
  alt: '#66dd88',
  hdg: '#ddaa55',
  thr: '#ee6655',
  vs: '#bb77cc',
  home: '#5599ee'
} as const

function SpdIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -10 20 20">
      <path
        d="M-8,4 A9,9 0 1,1 8,4"
        fill="none"
        stroke={COLORS.spd}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="0"
        y1="0"
        x2="3"
        y2="-6"
        stroke={COLORS.spd}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="0" cy="0" r="1.5" fill={COLORS.spd} />
    </svg>
  )
}

function AltIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -10 20 20">
      <path
        d="M-8,6 L-2,-4 L1,1 L5,-6 L9,6"
        fill="none"
        stroke={COLORS.alt}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="-2"
        y1="-4"
        x2="-2"
        y2="-8"
        stroke={COLORS.alt}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="-2" cy="-8.5" r="1.2" fill={COLORS.alt} opacity="0.6" />
    </svg>
  )
}

function HdgIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -10 20 20">
      <circle cx="0" cy="0" r="8.5" fill="none" stroke={COLORS.hdg} strokeWidth="1" />
      <polygon points="0,-7 1.5,-1.5 0,0 -1.5,-1.5" fill={COLORS.hdg} />
      <polygon points="0,7 1.5,1.5 0,0 -1.5,1.5" fill={COLORS.hdg} opacity="0.3" />
    </svg>
  )
}

function ThrIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -10 20 20">
      <rect
        x="-3"
        y="-8"
        width="6"
        height="16"
        rx="2"
        fill="none"
        stroke={COLORS.thr}
        strokeWidth="1"
      />
      <rect x="-2" y="-8" width="4" height="10" rx="1.5" fill={COLORS.thr} opacity="0.35" />
      <line
        x1="-5"
        y1="-2"
        x2="5"
        y2="-2"
        stroke={COLORS.thr}
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  )
}

function VsIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -10 20 20">
      <polyline
        points="-5,-2 0,-7 5,-2"
        fill="none"
        stroke={COLORS.vs}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="-5,3 0,-2 5,3"
        fill="none"
        stroke={COLORS.vs}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <polyline
        points="-5,8 0,3 5,8"
        fill="none"
        stroke={COLORS.vs}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.25"
      />
    </svg>
  )
}

function HomeIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="-10 -12 20 24">
      <path
        d="M0,-8 C4.5,-8 8,-4.5 8,0 C8,4 0,10 0,10 C0,10 -8,4 -8,0 C-8,-4.5 -4.5,-8 0,-8Z"
        fill="none"
        stroke={COLORS.home}
        strokeWidth="1.2"
      />
      <circle
        cx="0"
        cy="-1"
        r="2.8"
        fill="none"
        stroke={COLORS.home}
        strokeWidth="0.8"
        opacity="0.6"
      />
    </svg>
  )
}

interface RowProps {
  icon: React.JSX.Element
  label: string
  value: string
  unit: string
  color: string
  barPct?: number
}

function InstrumentRow({ icon, label, value, unit, color, barPct }: RowProps): React.JSX.Element {
  return (
    <>
      <div className={styles.row}>
        <div className={styles.icon}>{icon}</div>
        <span className={styles.label} style={{ color }}>
          {label}
        </span>
        <span className={styles.value}>
          {value}
          <span className={styles.unit}>{unit}</span>
        </span>
      </div>
      {barPct != null && (
        <div className={styles.bar}>
          <div
            className={styles.barFill}
            style={{
              width: `${Math.max(0, Math.min(100, barPct))}%`,
              background: color,
              boxShadow: `0 0 6px ${color}40`
            }}
          />
        </div>
      )}
    </>
  )
}

export function FloatingInstruments(): React.JSX.Element | null {
  const core = useTelemetry('core')
  const vfrHud = useTelemetry('vfrHud')
  const gps = useTelemetry('gps')
  const home = useHomePosition()

  // Hide entirely when no vehicle is connected or communication lost
  if (!core || core.communicationLost) return null

  const spd = vfrHud?.groundspeed
  const alt = gps?.relativeAlt ?? vfrHud?.altitude
  const hdg = vfrHud?.heading
  const thr = vfrHud?.throttle
  const vs = vfrHud?.climbRate
  const distToHome = gps && home ? distanceM(gps.lat, gps.lon, home.lat, home.lon) : null

  const homeFmt =
    distToHome != null
      ? distToHome >= 1000
        ? (distToHome / 1000).toFixed(2)
        : distToHome.toFixed(0)
      : '--'
  const homeUnit = distToHome != null ? (distToHome >= 1000 ? 'km' : 'm') : 'm'

  return (
    <div className={styles.wrapper}>
      <div className={styles.root}>
        <InstrumentRow
          icon={<SpdIcon />}
          label="SPD"
          value={fmt(spd, 1)}
          unit="m/s"
          color={COLORS.spd}
          barPct={spd != null ? (spd / 50) * 100 : undefined}
        />
        <InstrumentRow
          icon={<AltIcon />}
          label="ALT"
          value={fmt(alt, 1)}
          unit="m"
          color={COLORS.alt}
          barPct={alt != null ? (alt / 200) * 100 : undefined}
        />
        <InstrumentRow
          icon={<HdgIcon />}
          label="HDG"
          value={fmt(hdg, 0)}
          unit="deg"
          color={COLORS.hdg}
          barPct={hdg != null ? (hdg / 360) * 100 : undefined}
        />
        <InstrumentRow
          icon={<ThrIcon />}
          label="THR"
          value={fmt(thr, 0)}
          unit="%"
          color={COLORS.thr}
          barPct={thr != null ? thr : undefined}
        />
        <InstrumentRow
          icon={<VsIcon />}
          label="VS"
          value={fmt(vs, 1)}
          unit="m/s"
          color={COLORS.vs}
        />
        <InstrumentRow
          icon={<HomeIcon />}
          label="HOME"
          value={homeFmt}
          unit={homeUnit}
          color={COLORS.home}
        />
      </div>
    </div>
  )
}
