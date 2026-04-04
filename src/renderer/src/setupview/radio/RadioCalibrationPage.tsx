import { useCallback, useMemo } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useSetupStore } from '../../store/setupStore'
import { RcCalStep } from '../../../../shared-types/ipc/SetupTypes'
import { ChannelBar } from './ChannelBar'
import styles from './RadioCalibrationPage.module.css'

const STICK_NAMES = ['Roll', 'Pitch', 'Throttle', 'Yaw']

const STEP_INSTRUCTIONS: Record<string, { title: string; detail: string }> = {
  [RcCalStep.Idle]: {
    title: 'Ready',
    detail: 'Press Start to begin RC calibration'
  },
  [RcCalStep.Center]: {
    title: 'Step 1: Center',
    detail: 'Center all sticks and switches, then press Next'
  },
  [RcCalStep.DetectSticks]: {
    title: 'Step 2: Detect Sticks',
    detail: 'Move the indicated stick to full deflection, then press Next'
  },
  [RcCalStep.MinMax]: {
    title: 'Step 3: Ranges',
    detail: 'Move all sticks and switches to their extremes, then press Next'
  },
  [RcCalStep.Complete]: {
    title: 'Complete',
    detail: 'Calibration complete — press Save to write parameters'
  }
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
  const isCalibrating = !isIdle && !isComplete

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

  // Build channel-to-function mapping from stick detection
  const channelFunctions = useMemo(() => {
    const map: Record<number, string> = {}
    if (rcCalState?.stickMapping) {
      for (const [stick, ch] of Object.entries(rcCalState.stickMapping)) {
        if (ch !== null) map[ch] = stick
      }
    }
    // Default mapping for channels 0-3 if not detected
    const defaults: Record<number, string> = { 0: 'Roll', 1: 'Pitch', 2: 'Throttle', 3: 'Yaw' }
    for (const [ch, label] of Object.entries(defaults)) {
      if (!(Number(ch) in map)) map[Number(ch)] = label
    }
    return map
  }, [rcCalState?.stickMapping])

  // Split channels into attitude (stick-mapped) and aux
  const attitudeChannels = useMemo(() => {
    const result: Array<{ index: number; label: string }> = []
    for (let i = 0; i < Math.max(channelCount, 4); i++) {
      if (channelFunctions[i]) {
        result.push({ index: i, label: channelFunctions[i] })
      }
    }
    return result
  }, [channelCount, channelFunctions])

  const auxChannels = useMemo(() => {
    const result: number[] = []
    for (let i = 0; i < Math.max(channelCount, 8); i++) {
      if (!channelFunctions[i]) result.push(i)
    }
    return result
  }, [channelCount, channelFunctions])

  const stepInfo = STEP_INSTRUCTIONS[step] ?? STEP_INSTRUCTIONS[RcCalStep.Idle]!

  return (
    <div className={styles.root}>
      <div className={styles.title}>Radio Calibration</div>

      {/* Status + instruction card */}
      <div className={styles.statusCard}>
        <div className={styles.statusLeft}>
          <span className={hasRcInput ? styles.statusDotOk : styles.statusDotOff} />
          <span className={hasRcInput ? styles.statusTextOk : styles.statusTextOff}>
            {hasRcInput ? `${channelCount} channels` : 'No RC input'}
          </span>
        </div>

        <div className={styles.statusCenter}>
          <span className={styles.stepTitle}>{stepInfo.title}</span>
          <span className={styles.stepDetail}>
            {step === RcCalStep.DetectSticks && rcCalState?.currentStick
              ? `Move ${rcCalState.currentStick} stick to full deflection`
              : stepInfo.detail}
          </span>
        </div>

        <div className={styles.statusActions}>
          {isIdle && (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleStart}
              disabled={!hasRcInput}
            >
              Start
            </button>
          )}
          {isCalibrating && (
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
      </div>

      {/* Stick mapping during detect phase */}
      {(step === RcCalStep.DetectSticks ||
        step === RcCalStep.MinMax ||
        step === RcCalStep.Complete) && (
        <div className={styles.stickMapping}>
          {STICK_NAMES.map((name) => {
            const ch = rcCalState?.stickMapping[name]
            const isDetecting = step === RcCalStep.DetectSticks && rcCalState?.currentStick === name
            return (
              <div
                key={name}
                className={`${styles.stickChip} ${ch !== null && ch !== undefined ? styles.stickChipMapped : ''} ${isDetecting ? styles.stickChipActive : ''}`}
              >
                <span className={styles.stickName}>{name}</span>
                <span className={styles.stickChannel}>
                  {ch !== null && ch !== undefined ? `CH ${ch + 1}` : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Channel bars */}
      <div className={styles.channelLayout}>
        {/* Attitude channels — primary sticks */}
        <div className={styles.channelSection}>
          <div className={styles.sectionLabel}>Attitude Controls</div>
          <div className={styles.channelGrid}>
            {attitudeChannels.map(({ index, label }) => {
              const calCh = rcCalState?.channels[index]
              return (
                <ChannelBar
                  key={index}
                  index={index}
                  value={channels[index] ?? 0}
                  min={calCh?.min}
                  max={calCh?.max}
                  functionLabel={label}
                  primary
                />
              )
            })}
          </div>
        </div>

        {/* Auxiliary channels */}
        {auxChannels.length > 0 && (
          <div className={styles.channelSection}>
            <div className={styles.sectionLabel}>Auxiliary Channels</div>
            <div className={styles.channelGrid}>
              {auxChannels.map((index) => {
                const calCh = rcCalState?.channels[index]
                return (
                  <ChannelBar
                    key={index}
                    index={index}
                    value={channels[index] ?? 0}
                    min={calCh?.min}
                    max={calCh?.max}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
