import { useState, useCallback, useEffect } from 'react'
import { useActuatorTest } from '../../hooks/useActuatorTest'
import styles from './ActuatorsPage.module.css'

const TEST_THROTTLE = 15 // 15% throttle — enough to identify, not dangerous
const SPIN_DURATION_MS = 1500

interface Props {
  motorCount: number
  disabled: boolean
}

/**
 * Motor identification wizard: spins motors one at a time so the user
 * can verify which physical motor corresponds to which channel.
 */
export function MotorIdentification({ motorCount, disabled }: Props): React.JSX.Element {
  const { motorTest, stopAllMotors } = useActuatorTest()

  const [running, setRunning] = useState(false)
  const [currentMotor, setCurrentMotor] = useState(0) // 0-based index
  const [spinning, setSpinning] = useState(false)

  // Stop motors on unmount or when running becomes false
  useEffect(() => {
    if (!running) return
    return () => {
      stopAllMotors(motorCount)
    }
  }, [running, stopAllMotors, motorCount])

  const spinCurrent = useCallback(
    (motorIndex: number) => {
      setSpinning(true)
      motorTest(motorIndex + 1, TEST_THROTTLE, 3)
      setTimeout(() => {
        stopAllMotors(motorCount)
        setSpinning(false)
      }, SPIN_DURATION_MS)
    },
    [motorTest, stopAllMotors, motorCount]
  )

  const handleStart = useCallback(() => {
    setCurrentMotor(0)
    setRunning(true)
    spinCurrent(0)
  }, [spinCurrent])

  const handleStop = useCallback(() => {
    stopAllMotors(motorCount)
    setSpinning(false)
    setRunning(false)
    setCurrentMotor(0)
  }, [stopAllMotors, motorCount])

  const handleSpinAgain = useCallback(() => {
    stopAllMotors(motorCount)
    spinCurrent(currentMotor)
  }, [stopAllMotors, motorCount, currentMotor, spinCurrent])

  const handleNext = useCallback(() => {
    stopAllMotors(motorCount)
    setSpinning(false)
    const next = currentMotor + 1
    if (next >= motorCount) {
      setRunning(false)
      setCurrentMotor(0)
      return
    }
    setCurrentMotor(next)
    spinCurrent(next)
  }, [stopAllMotors, motorCount, currentMotor, spinCurrent])

  // Auto-stop if controls become disabled (e.g. vehicle armed mid-test).
  // The setState calls are intentional — we need to reset wizard state when
  // the external `disabled` prop changes, alongside the motor-stop side effect.
  useEffect(() => {
    if (disabled && running) {
      stopAllMotors(motorCount)
      setSpinning(false) // eslint-disable-line react-hooks/set-state-in-effect
      setRunning(false)
      setCurrentMotor(0)
    }
  }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!running) {
    return (
      <div className={styles.identifySection}>
        <div className={styles.identifyRow}>
          <span className={styles.identifyText}>
            Spin motors one at a time to identify their position
          </span>
          <button className={styles.identifyBtn} onClick={handleStart} disabled={disabled}>
            Identify Motors
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.identifySection}>
      <div className={styles.identifyStatus}>
        <div className={styles.identifyMotorIndicator}>
          <span className={styles.identifyMotorLabel}>
            Motor {currentMotor + 1} of {motorCount}
          </span>
          {spinning && <span className={styles.identifySpinBadge}>SPINNING</span>}
        </div>

        <div className={styles.identifyProgressBar}>
          <div
            className={styles.identifyProgressFill}
            style={{ width: `${((currentMotor + (spinning ? 0.5 : 1)) / motorCount) * 100}%` }}
          />
        </div>

        <div className={styles.identifyControls}>
          <button className={styles.identifyBtn} onClick={handleSpinAgain}>
            Spin Again
          </button>
          <button className={styles.identifyBtn} onClick={handleNext}>
            Next
          </button>
          <button className={styles.stopBtn} onClick={handleStop}>
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}
