import { useCallback } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useSetupStore } from '../../store/setupStore'
import { RcCalStep } from '../../../../shared-types/ipc/SetupTypes'
import { ChannelBar } from './ChannelBar'
import styles from './RadioCalibrationPage.module.css'

/** Default channel function labels (ArduPilot convention) */
const DEFAULT_CHANNEL_FUNCTIONS: Record<number, string> = {
  0: 'Roll',
  1: 'Pitch',
  2: 'Throttle',
  3: 'Yaw'
}

const STEP_LABELS: Record<string, string> = {
  [RcCalStep.Idle]: 'Press Start to begin RC calibration',
  [RcCalStep.Center]: 'Center all sticks and switches, then press Next',
  [RcCalStep.DetectSticks]: 'Move the indicated stick to full deflection, then press Next',
  [RcCalStep.MinMax]: 'Move all sticks to their extremes, then press Next',
  [RcCalStep.Complete]: 'Calibration complete — press Save to write parameters'
}

export function RadioCalibrationPage(): React.JSX.Element {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const rc = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid]?.rc : undefined
  })
  const rcCalState = useSetupStore((s) => s.rcCalibrationState)
  const vehicleId = activeId ?? 1

  const step = rcCalState?.step ?? RcCalStep.Idle
  const isIdle = step === RcCalStep.Idle
  const isComplete = step === RcCalStep.Complete

  const handleStart = useCallback(() => {
    window.bridge?.rcCalibrationStart(vehicleId)
  }, [vehicleId])

  const handleNext = useCallback(() => {
    window.bridge?.rcCalibrationNextStep(vehicleId)
  }, [vehicleId])

  const handleCancel = useCallback(() => {
    window.bridge?.rcCalibrationCancel(vehicleId)
  }, [vehicleId])

  const handleSave = useCallback(() => {
    window.bridge?.rcCalibrationSave(vehicleId)
  }, [vehicleId])

  const channels = rc?.channels ?? []
  const channelCount = rc?.channelCount ?? channels.length
  const hasRcInput = channels.some((v) => v > 0)

  // Build channel-to-function mapping: use stick mapping if available, otherwise defaults
  const channelFunctions: Record<number, string> = {}
  if (rcCalState?.stickMapping) {
    for (const [stick, ch] of Object.entries(rcCalState.stickMapping)) {
      if (ch !== null) channelFunctions[ch] = stick
    }
  }
  // Fill in defaults for unmapped channels
  for (const [ch, label] of Object.entries(DEFAULT_CHANNEL_FUNCTIONS)) {
    if (!(Number(ch) in channelFunctions)) {
      channelFunctions[Number(ch)] = label
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Radio Calibration</div>
      <div className={styles.subtitle}>{STEP_LABELS[step] ?? ''}</div>

      {/* Connection status */}
      <div className={styles.rcStatus}>
        <span className={hasRcInput ? styles.rcStatusDotOk : styles.rcStatusDotOff} />
        <span className={hasRcInput ? styles.rcStatusTextOk : styles.rcStatusTextOff}>
          {hasRcInput ? `RC input active (${channelCount} channels)` : 'No RC input detected'}
        </span>
      </div>

      <div className={styles.toolbar}>
        {isIdle && (
          <button className={styles.btn} onClick={handleStart}>
            Start
          </button>
        )}
        {!isIdle && !isComplete && (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleNext}>
              Next
            </button>
            <button className={styles.btn} onClick={handleCancel}>
              Cancel
            </button>
          </>
        )}
        {isComplete && (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
              Save
            </button>
            <button className={styles.btn} onClick={handleCancel}>
              Discard
            </button>
          </>
        )}
      </div>

      <div className={styles.channelGrid}>
        {Array.from({ length: Math.max(channelCount, 8) }, (_, i) => {
          const calCh = rcCalState?.channels[i]
          return (
            <ChannelBar
              key={i}
              index={i}
              value={channels[i] ?? 0}
              min={calCh?.min}
              max={calCh?.max}
              functionLabel={channelFunctions[i]}
            />
          )
        })}
      </div>

      {rcCalState && (
        <div className={styles.stickMapping}>
          {Object.entries(rcCalState.stickMapping).map(([stick, ch]) => (
            <span key={stick} className={styles.stickItem}>
              {stick}:{' '}
              <span className={styles.stickItemValue}>
                {ch !== null ? `CH${ch + 1}` : '—'}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
