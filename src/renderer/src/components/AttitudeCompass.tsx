import { useTelemetry } from '../hooks/useVehicle'
import styles from './AttitudeCompass.module.css'

const RAD_TO_DEG = 180 / Math.PI

const CARD_DIRS = [
  { angle: 0, label: 'N' },
  { angle: 90, label: 'E' },
  { angle: 180, label: 'S' },
  { angle: 270, label: 'W' }
] as const

const TICK_COUNT = 36

interface AttitudeCompassProps {
  size?: number
}

export function AttitudeCompass({ size = 120 }: AttitudeCompassProps): React.JSX.Element {
  const attitude = useTelemetry('attitude')
  const vfrHud = useTelemetry('vfrHud')
  const heading = vfrHud?.heading ?? null

  const rollDeg = attitude ? attitude.roll * RAD_TO_DEG : 0
  const pitchDeg = attitude ? attitude.pitch * RAD_TO_DEG : 0
  const pitchOffset = pitchDeg * 2

  const r = 96
  const tickOuter = r - 2
  const tickMajor = r - 14
  const tickMinor = r - 9
  const labelR = r - 24

  return (
    <div className={styles.root}>
      {/* Attitude indicator */}
      <svg
        width={size}
        height={size}
        viewBox="-100 -100 200 200"
        aria-label={`Attitude: roll ${rollDeg.toFixed(1)} pitch ${pitchDeg.toFixed(1)}`}
        className={styles.instrument}
      >
        <defs>
          <clipPath id="ac-circle-clip">
            <circle cx="0" cy="0" r="98" />
          </clipPath>
        </defs>

        <g clipPath="url(#ac-circle-clip)">
          {attitude ? (
            <g transform={`rotate(${-rollDeg})`}>
              <rect x="-200" y={-200 + pitchOffset} width="400" height="200" fill="#4A90D9" />
              <rect x="-200" y={pitchOffset} width="400" height="200" fill="#8B6914" />
              <line
                x1="-150"
                y1={pitchOffset}
                x2="150"
                y2={pitchOffset}
                stroke="white"
                strokeWidth="1.5"
              />
              {[-20, -10, 10, 20].map((deg) => (
                <g key={deg} transform={`translate(0, ${pitchOffset + deg * 2})`}>
                  <line
                    x1={deg % 20 === 0 ? -30 : -20}
                    y1="0"
                    x2={deg % 20 === 0 ? 30 : 20}
                    y2="0"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.7"
                  />
                  <text x="35" y="4" fontSize="8" fill="white" opacity="0.7">
                    {Math.abs(deg)}
                  </text>
                </g>
              ))}
            </g>
          ) : (
            <>
              <rect x="-200" y="-200" width="400" height="200" fill="#4A90D9" />
              <rect x="-200" y="0" width="400" height="200" fill="#8B6914" />
              <line x1="-150" y1="0" x2="150" y2="0" stroke="white" strokeWidth="1.5" />
            </>
          )}

          <line x1="-45" y1="0" x2="-12" y2="0" stroke="#FFD700" strokeWidth="3" />
          <line x1="12" y1="0" x2="45" y2="0" stroke="#FFD700" strokeWidth="3" />
          <circle cx="0" cy="0" r="3" fill="#FFD700" />

          {attitude && (
            <g transform={`rotate(${-rollDeg})`}>
              <polygon points="0,-92 -5,-82 5,-82" fill="white" opacity="0.8" />
            </g>
          )}
        </g>

        <circle cx="0" cy="0" r="98" fill="none" stroke="#444" strokeWidth="2" />
      </svg>

      {/* Heading readout between instruments */}
      <div className={styles.headingReadout}>
        {heading !== null ? `${heading.toFixed(0)}\u00B0` : 'OFF'}
      </div>

      {/* Compass */}
      <svg
        width={size}
        height={size}
        viewBox="-100 -100 200 200"
        aria-label={heading !== null ? `Heading ${heading.toFixed(0)}` : 'No heading'}
        className={styles.instrument}
      >
        <defs>
          <clipPath id="ac-compass-clip">
            <circle cx="0" cy="0" r={r} />
          </clipPath>
        </defs>

        <circle cx="0" cy="0" r={r} fill="#1a1a2e" />
        <circle cx="0" cy="0" r={r} fill="none" stroke="#444" strokeWidth="2" />

        <g transform={`rotate(${-(heading ?? 0)})`} clipPath="url(#ac-compass-clip)">
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

        <polygon points="0,-98 -6,-88 6,-88" fill="white" />
        <polygon points="0,-35 -12,16 0,6 12,16" fill="#ff4444" opacity="0.9" />
        <polygon points="0,35 -12,16 0,6 12,16" fill="#991111" opacity="0.7" />
        <circle cx="0" cy="0" r="3" fill="white" opacity="0.6" />
      </svg>
    </div>
  )
}
