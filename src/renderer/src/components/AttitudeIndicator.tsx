import { useTelemetry } from '../hooks/useVehicle'
import styles from './AttitudeIndicator.module.css'

const RAD_TO_DEG = 180 / Math.PI

export function AttitudeIndicator(): React.JSX.Element {
  const attitude = useTelemetry('attitude')

  if (!attitude) {
    return <div className={styles.noData}>No data</div>
  }

  const rollDeg = attitude.roll * RAD_TO_DEG
  const pitchDeg = attitude.pitch * RAD_TO_DEG
  const pitchOffset = pitchDeg * 2

  return (
    <svg
      width={150}
      height={150}
      viewBox="-100 -100 200 200"
      aria-label={`Attitude: roll ${rollDeg.toFixed(1)}° pitch ${pitchDeg.toFixed(1)}°`}
      className={styles.svg}
    >
      <defs>
        <clipPath id="circle-clip">
          <circle cx="0" cy="0" r="98" />
        </clipPath>
      </defs>

      <g clipPath="url(#circle-clip)">
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

        <line x1="-45" y1="0" x2="-12" y2="0" stroke="#FFD700" strokeWidth="3" />
        <line x1="12" y1="0" x2="45" y2="0" stroke="#FFD700" strokeWidth="3" />
        <circle cx="0" cy="0" r="3" fill="#FFD700" />

        <g transform={`rotate(${-rollDeg})`}>
          <polygon points="0,-92 -5,-82 5,-82" fill="white" opacity="0.8" />
        </g>
      </g>

      <circle cx="0" cy="0" r="98" fill="none" stroke="#444" strokeWidth="2" />
    </svg>
  )
}
