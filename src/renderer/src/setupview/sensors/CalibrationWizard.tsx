import { useEffect, useRef } from 'react'
import {
  CalibrationStatus,
  CalibrationOrientation,
  CalibrationSensor,
  type CalibrationState
} from '../../../../shared-types/ipc/SetupTypes'
import { CompassCalibration } from './CompassCalibration'
import styles from './CalibrationWizard.module.css'

const ORIENTATION_META: Array<{
  id: CalibrationOrientation
  label: string
  description: string
}> = [
  { id: CalibrationOrientation.Level, label: 'Level', description: 'Right side up' },
  { id: CalibrationOrientation.UpsideDown, label: 'Upside Down', description: 'Flipped over' },
  { id: CalibrationOrientation.NoseDown, label: 'Nose Down', description: 'Front pointing down' },
  { id: CalibrationOrientation.NoseUp, label: 'Tail Down', description: 'Front pointing up' },
  { id: CalibrationOrientation.LeftSide, label: 'Left Side', description: 'Left wing down' },
  { id: CalibrationOrientation.RightSide, label: 'Right Side', description: 'Right wing down' }
]

/**
 * SVG quadcopter icon shown from the appropriate viewing angle for each orientation.
 * Each orientation gets a distinct rotation so the user can see how to physically
 * position the vehicle.
 */
function OrientationIcon({
  orientation,
  size = 80
}: {
  orientation: CalibrationOrientation
  size?: number
}): React.JSX.Element {
  // Rotation in degrees applied to the whole vehicle drawing.
  // The base drawing is a top-down quad (front = up).
  const rotation: Record<CalibrationOrientation, number> = {
    [CalibrationOrientation.Level]: 0, // top-down, right-side up
    [CalibrationOrientation.UpsideDown]: 180, // flipped
    [CalibrationOrientation.NoseDown]: -90, // front pointing down
    [CalibrationOrientation.NoseUp]: 90, // front pointing up
    [CalibrationOrientation.LeftSide]: -45, // tilted left
    [CalibrationOrientation.RightSide]: 45 // tilted right
  }

  const cx = size / 2
  const cy = size / 2
  const r = rotation[orientation]
  const arm = size * 0.24 // arm half-length
  const motor = size * 0.075 // motor radius
  const bodyRx = size * 0.1
  const bodyRy = size * 0.17

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(${r} ${cx} ${cy})`}>
        {/* Arms */}
        <line x1={cx - arm} y1={cy - arm} x2={cx + arm} y2={cy + arm}
          stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
        <line x1={cx + arm} y1={cy - arm} x2={cx - arm} y2={cy + arm}
          stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
        {/* Body */}
        <ellipse cx={cx} cy={cy} rx={bodyRx} ry={bodyRy}
          fill="currentColor" opacity={0.85} />
        {/* Motors */}
        <circle cx={cx - arm} cy={cy - arm} r={motor} fill="currentColor" opacity={0.6} />
        <circle cx={cx + arm} cy={cy - arm} r={motor} fill="currentColor" opacity={0.6} />
        <circle cx={cx - arm} cy={cy + arm} r={motor} fill="currentColor" opacity={0.6} />
        <circle cx={cx + arm} cy={cy + arm} r={motor} fill="currentColor" opacity={0.6} />
        {/* Front indicator (triangle) */}
        <polygon
          points={`${cx},${cy - bodyRy + 1} ${cx - 4},${cy - bodyRy + 8} ${cx + 4},${cy - bodyRy + 8}`}
          fill="currentColor" />
      </g>
      {/* Ground line for orientations that show tilt */}
      {orientation !== CalibrationOrientation.Level && (
        <line x1={size * 0.15} y1={size - 6} x2={size * 0.85} y2={size - 6}
          stroke="currentColor" strokeWidth={1} opacity={0.25} strokeDasharray="3 3" />
      )}
    </svg>
  )
}

interface Props {
  state: CalibrationState
  onCancel: () => void
  onDone: () => void
}

export function CalibrationWizard({ state, onCancel, onDone }: Props): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isFinished =
    state.status === CalibrationStatus.Complete ||
    state.status === CalibrationStatus.Failed ||
    state.status === CalibrationStatus.Cancelled

  const showOrientationGrid =
    state.sensor === CalibrationSensor.Accel ||
    state.sensor === CalibrationSensor.AccelSimple

  const statusLabel =
    state.status === CalibrationStatus.Complete
      ? 'Calibration Complete'
      : state.status === CalibrationStatus.Failed
        ? 'Calibration Failed'
        : state.status === CalibrationStatus.Cancelled
          ? 'Calibration Cancelled'
          : state.status === CalibrationStatus.WaitingForOrientation
            ? 'Place vehicle in one of the remaining orientations and hold still'
            : state.status === CalibrationStatus.Collecting
              ? 'Hold still — collecting data...'
              : 'Starting calibration...'

  // Auto-scroll message log
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length])

  // Compass gets its own dedicated visual experience
  if (state.sensor === CalibrationSensor.Compass) {
    return <CompassCalibration state={state} onCancel={onCancel} onDone={onDone} />
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.sensorLabel}>{state.sensor.toUpperCase()} CALIBRATION</span>
        <span
          className={`${styles.statusLabel} ${
            state.status === CalibrationStatus.Complete
              ? styles.statusSuccess
              : state.status === CalibrationStatus.Failed
                ? styles.statusError
                : ''
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Overall progress bar */}
      <div className={styles.progressBar}>
        <div
          className={`${styles.progressFill} ${
            state.status === CalibrationStatus.Complete
              ? styles.progressSuccess
              : state.status === CalibrationStatus.Failed
                ? styles.progressError
                : ''
          }`}
          style={{ width: `${(state.progress * 100).toFixed(0)}%` }}
        />
      </div>

      {/* 6-orientation grid for accel calibration */}
      {showOrientationGrid && (
        <div className={styles.orientationGrid}>
          {ORIENTATION_META.map(({ id, label, description }) => {
            const isDone = state.orientationsCompleted.includes(id)
            const isCurrent = state.currentOrientation === id
            return (
              <div
                key={id}
                className={`${styles.orientationCard} ${
                  isDone
                    ? styles.cardDone
                    : isCurrent
                      ? styles.cardActive
                      : styles.cardPending
                }`}
              >
                <div className={styles.cardIcon}>
                  <OrientationIcon orientation={id} />
                </div>
                <div className={styles.cardLabel}>{label}</div>
                <div className={styles.cardStatus}>
                  {isDone ? 'Completed' : isCurrent ? 'Hold still...' : description}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Message log */}
      <div className={styles.messageLog}>
        {state.messages.map((msg, i) => (
          <div key={i} className={styles.messageLine}>
            {msg}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Action button */}
      <div className={styles.actions}>
        {isFinished ? (
          <button className={styles.doneBtn} onClick={onDone}>
            Done
          </button>
        ) : (
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
