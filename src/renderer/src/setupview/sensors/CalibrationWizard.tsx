import {
  CalibrationStatus,
  CalibrationOrientation,
  CalibrationSensor,
  type CalibrationState
} from '../../../../shared-types/ipc/SetupTypes'
import { useSetupStore } from '../../store/setupStore'
import styles from './SensorCalibrationPage.module.css'

const ORIENTATION_LABELS: Record<CalibrationOrientation, string> = {
  [CalibrationOrientation.Level]: 'Level',
  [CalibrationOrientation.UpsideDown]: 'Upside Down',
  [CalibrationOrientation.NoseDown]: 'Nose Down',
  [CalibrationOrientation.NoseUp]: 'Nose Up',
  [CalibrationOrientation.LeftSide]: 'Left Side',
  [CalibrationOrientation.RightSide]: 'Right Side'
}

const ALL_ORIENTATIONS = Object.values(CalibrationOrientation)

interface Props {
  state: CalibrationState
  onCancel: () => void
  onDone: () => void
}

export function CalibrationWizard({ state, onCancel, onDone }: Props): React.JSX.Element {
  const magCalProgress = useSetupStore((s) => s.magCalProgress)

  const isFinished =
    state.status === CalibrationStatus.Complete ||
    state.status === CalibrationStatus.Failed ||
    state.status === CalibrationStatus.Cancelled

  const progressClass =
    state.status === CalibrationStatus.Complete
      ? styles.progressComplete
      : state.status === CalibrationStatus.Failed
        ? styles.progressFailed
        : ''

  const statusLabel =
    state.status === CalibrationStatus.Complete
      ? 'Calibration Complete'
      : state.status === CalibrationStatus.Failed
        ? 'Calibration Failed'
        : state.status === CalibrationStatus.Cancelled
          ? 'Calibration Cancelled'
          : state.status === CalibrationStatus.WaitingForOrientation
            ? 'Position the vehicle as instructed'
            : state.status === CalibrationStatus.Collecting
              ? 'Collecting data...'
              : 'Starting calibration...'

  const showOrientations =
    state.sensor === CalibrationSensor.Accel && state.orientationsCompleted.length > 0

  const showMagProgress =
    state.sensor === CalibrationSensor.Compass && magCalProgress.length > 0 && !isFinished

  return (
    <div className={styles.wizardOverlay}>
      <div className={styles.wizardSensor}>{state.sensor.toUpperCase()} CALIBRATION</div>
      <div className={styles.wizardStatus}>{statusLabel}</div>

      <div className={styles.progressBarWrap}>
        <div
          className={`${styles.progressBarFill} ${progressClass}`}
          style={{ width: `${(state.progress * 100).toFixed(0)}%` }}
        />
      </div>

      {showOrientations && (
        <div className={styles.orientations}>
          {ALL_ORIENTATIONS.map((orient) => {
            const isDone = state.orientationsCompleted.includes(orient)
            const isCurrent = state.currentOrientation === orient
            const cls = isDone
              ? styles.orientationDone
              : isCurrent
                ? styles.orientationCurrent
                : ''
            return (
              <span key={orient} className={`${styles.orientationBadge} ${cls}`}>
                {ORIENTATION_LABELS[orient]}
              </span>
            )
          })}
        </div>
      )}

      {showMagProgress && (
        <div className={styles.magProgressGrid}>
          {magCalProgress.map((mag) => (
            <div key={mag.compassId} className={styles.magProgressItem}>
              <span className={styles.magProgressLabel}>Compass {mag.compassId}</span>
              <div className={styles.progressBarWrap}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${mag.completionPct}%` }}
                />
              </div>
              <span className={styles.magProgressPct}>{mag.completionPct}%</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.wizardMessage}>{state.message}</div>

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
  )
}
