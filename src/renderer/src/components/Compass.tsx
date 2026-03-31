import { useTelemetry } from '../hooks/useVehicle'
import styles from './Compass.module.css'

const CARD_DIRS = [
  { angle: 0, label: 'N' },
  { angle: 90, label: 'E' },
  { angle: 180, label: 'S' },
  { angle: 270, label: 'W' }
] as const

const TICK_COUNT = 36 // every 10°

export function Compass({ size = 150 }: { size?: number }): React.JSX.Element {
  const vfrHud = useTelemetry('vfrHud')
  const heading = vfrHud?.heading ?? null

  if (heading === null) {
    return <div className={styles.noData} style={{ width: size, height: size }}>No data</div>
  }

  const r = 96 // compass dial radius
  const tickOuter = r - 2
  const tickMajor = r - 14
  const tickMinor = r - 9
  const labelR = r - 24

  return (
    <svg
      width={size}
      height={size}
      viewBox="-100 -100 200 200"
      aria-label={`Heading ${heading.toFixed(0)}°`}
      className={styles.svg}
    >
      <defs>
        <clipPath id="compass-clip">
          <circle cx="0" cy="0" r={r} />
        </clipPath>
      </defs>

      {/* Background */}
      <circle cx="0" cy="0" r={r} fill="#1a1a2e" />

      {/* Outer bezel ring */}
      <circle cx="0" cy="0" r={r} fill="none" stroke="#444" strokeWidth="2" />

      {/* Rotating compass dial */}
      <g transform={`rotate(${-heading})`} clipPath="url(#compass-clip)">
        {/* Tick marks every 10° */}
        {Array.from({ length: TICK_COUNT }, (_, i) => {
          const deg = i * 10
          const isMajor = deg % 30 === 0
          const rad = (deg * Math.PI) / 180
          const outerX = Math.sin(rad) * tickOuter
          const outerY = -Math.cos(rad) * tickOuter
          const innerR = isMajor ? tickMajor : tickMinor
          const innerX = Math.sin(rad) * innerR
          const innerY = -Math.cos(rad) * innerR

          return (
            <line
              key={deg}
              x1={innerX}
              y1={innerY}
              x2={outerX}
              y2={outerY}
              stroke="white"
              strokeWidth={isMajor ? 2 : 1}
              opacity={isMajor ? 0.9 : 0.5}
            />
          )
        })}

        {/* Cardinal direction labels */}
        {CARD_DIRS.map(({ angle, label }) => {
          const rad = (angle * Math.PI) / 180
          const x = Math.sin(rad) * labelR
          const y = -Math.cos(rad) * labelR

          return (
            <text
              key={label}
              x={x}
              y={y}
              fill={label === 'N' ? '#ff4444' : 'white'}
              fontSize="14"
              fontWeight="bold"
              fontFamily="var(--font-mono)"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          )
        })}
      </g>

      {/* Fixed heading indicator (top triangle) */}
      <polygon points="0,-98 -6,-88 6,-88" fill="white" />

      {/* Compass needle — fixed, always points up (north relative to heading) */}
      <polygon points="0,-35 -12,16 0,6 12,16" fill="#ff4444" opacity="0.9" />
      <polygon points="0,35 -12,16 0,6 12,16" fill="#991111" opacity="0.7" />

      {/* Center dot */}
      <circle cx="0" cy="0" r="3" fill="white" opacity="0.6" />

      {/* Heading readout */}
      <text
        x="0"
        y="52"
        fill="white"
        fontSize="12"
        fontWeight="bold"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {heading.toFixed(0)}°
      </text>
    </svg>
  )
}
