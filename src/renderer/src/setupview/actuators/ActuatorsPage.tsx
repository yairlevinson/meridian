import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTelemetry } from '../../hooks/useVehicle'
import { useActuatorTest } from '../../hooks/useActuatorTest'
import { useParameterStore } from '../../store/parameterStore'
import { OutputConfigSection } from './OutputConfigSection'
import { MotorIdentification } from './MotorIdentification'
import { MotorSpinDirection } from './MotorSpinDirection'
import { getServoFunctionName } from './servoFunctions'
import styles from './ActuatorsPage.module.css'

const DEFAULT_MOTOR_COUNT = 4
const DEFAULT_SERVO_COUNT = 8
const DEFAULT_TIMEOUT_S = 3
const SERVO_MIN = 1000
const SERVO_MAX = 2000
const SERVO_CENTER = 1500
const WATCHDOG_MS = 2000

export function ActuatorsPage(): React.JSX.Element {
  const core = useTelemetry('core')
  const servoOutput = useTelemetry('servoOutput')
  const { motorTest, servoTest, stopAllMotors } = useActuatorTest()

  const [safetyEnabled, setSafetyEnabled] = useState(false)
  const [motorCount, setMotorCount] = useState(DEFAULT_MOTOR_COUNT)
  const [timeoutS, setTimeoutS] = useState(DEFAULT_TIMEOUT_S)
  const [motorValues, setMotorValues] = useState<number[]>(() => Array(8).fill(0))
  const [allMotorsValue, setAllMotorsValue] = useState(0)
  const [servoValues, setServoValues] = useState<number[]>(() =>
    Array(DEFAULT_SERVO_COUNT).fill(SERVO_CENTER)
  )

  const isArmed = core?.armed ?? false
  const controlsDisabled = isArmed || !safetyEnabled

  // Watchdog: track last interaction time, auto-stop if idle
  const lastInteraction = useRef(0)
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const touchWatchdog = useCallback(() => {
    lastInteraction.current = Date.now()
  }, [])

  // Start/stop watchdog when safety switch changes
  useEffect(() => {
    if (safetyEnabled && !isArmed) {
      watchdogRef.current = setInterval(() => {
        if (Date.now() - lastInteraction.current > WATCHDOG_MS) {
          // Auto-stop all motors
          stopAllMotors(motorCount)
          setMotorValues(Array(8).fill(0))
          setAllMotorsValue(0)
        }
      }, 500)
    } else {
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
      }
    }
    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current)
    }
  }, [safetyEnabled, isArmed, motorCount, stopAllMotors])

  // Stop all tests when leaving the page or disabling safety
  useEffect(() => {
    return () => {
      stopAllMotors(8)
    }
  }, [stopAllMotors])

  // If vehicle becomes armed while testing, stop all motors
  const armedRef = useRef(isArmed)
  useEffect(() => {
    if (isArmed && !armedRef.current) {
      stopAllMotors(motorCount)
    }
    armedRef.current = isArmed
  }, [isArmed, motorCount, stopAllMotors])

  const handleMotorChange = useCallback(
    (index: number, value: number) => {
      touchWatchdog()
      setMotorValues((prev) => {
        const next = [...prev]
        next[index] = value
        return next
      })
      motorTest(index + 1, value, timeoutS)
    },
    [motorTest, timeoutS, touchWatchdog]
  )

  const handleAllMotorsChange = useCallback(
    (value: number) => {
      touchWatchdog()
      setAllMotorsValue(value)
      const next = Array(8).fill(0)
      for (let i = 0; i < motorCount; i++) {
        next[i] = value
        motorTest(i + 1, value, timeoutS)
      }
      setMotorValues(next)
    },
    [motorTest, motorCount, timeoutS, touchWatchdog]
  )

  const handleServoChange = useCallback(
    (index: number, value: number) => {
      touchWatchdog()
      setServoValues((prev) => {
        const next = [...prev]
        next[index] = value
        return next
      })
      servoTest(index + 1, value)
    },
    [servoTest, touchWatchdog]
  )

  const handleServoCenter = useCallback(
    (index: number) => {
      touchWatchdog()
      setServoValues((prev) => {
        const next = [...prev]
        next[index] = SERVO_CENTER
        return next
      })
      servoTest(index + 1, SERVO_CENTER)
    },
    [servoTest, touchWatchdog]
  )

  const handleStopAll = useCallback(() => {
    stopAllMotors(motorCount)
    setMotorValues(Array(8).fill(0))
    setAllMotorsValue(0)
  }, [stopAllMotors, motorCount])

  const handleSafetyToggle = useCallback(() => {
    if (safetyEnabled) {
      // Turning off: stop everything
      stopAllMotors(motorCount)
      setMotorValues(Array(8).fill(0))
      setAllMotorsValue(0)
    }
    setSafetyEnabled((prev) => !prev)
  }, [safetyEnabled, stopAllMotors, motorCount])

  // Look up SERVOx_FUNCTION names for slider labels
  const parameters = useParameterStore((s) => s.parameters)
  const channelNames = useMemo(() => {
    const names: (string | null)[] = []
    for (let i = 1; i <= 16; i++) {
      const fnVal = parameters.get(`SERVO${i}_FUNCTION`)?.value
      names.push(getServoFunctionName(fnVal))
    }
    return names
  }, [parameters])

  // Live servo output data
  const outputs = servoOutput?.outputs ?? []

  return (
    <div className={styles.root}>
      <div className={styles.title}>Actuators</div>

      {isArmed && (
        <div className={styles.armedBanner}>Vehicle is armed — actuator testing is disabled</div>
      )}

      {safetyEnabled && !isArmed && (
        <div className={styles.warningBanner}>
          Careful: Actuator sliders are enabled — motors may spin
        </div>
      )}

      {/* Safety switch */}
      <div className={styles.safetyRow}>
        <span className={styles.safetyLabel}>Enable actuator testing</span>
        <button
          className={`${styles.safetyToggle} ${safetyEnabled ? styles.safetyToggleOn : ''}`}
          onClick={handleSafetyToggle}
          disabled={isArmed}
          aria-label="Toggle actuator testing"
        />
      </div>

      {/* Motor Layout Diagram */}
      <MotorSpinDirection />

      {/* Output Configuration */}
      <OutputConfigSection />

      {/* Motor Test Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Motor Test</span>
          <button className={styles.stopBtn} onClick={handleStopAll} disabled={controlsDisabled}>
            Stop All
          </button>
        </div>

        {/* Motor Identification Wizard */}
        <MotorIdentification motorCount={motorCount} disabled={controlsDisabled} />

        <div className={styles.motorCountRow}>
          <span className={styles.motorCountLabel}>Motors:</span>
          <select
            className={styles.motorCountSelect}
            value={motorCount}
            onChange={(e) => setMotorCount(Number(e.target.value))}
            disabled={controlsDisabled}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className={styles.configLabel}>Timeout:</span>
          <input
            className={styles.configInput}
            type="number"
            min={1}
            max={30}
            value={timeoutS}
            onChange={(e) => setTimeoutS(Math.max(1, Math.min(30, Number(e.target.value))))}
            disabled={controlsDisabled}
          />
          <span className={styles.configLabel}>s</span>
        </div>

        {/* All Motors slider */}
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>All Motors</span>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            step={5}
            value={allMotorsValue}
            onChange={(e) => handleAllMotorsChange(Number(e.target.value))}
            disabled={controlsDisabled}
          />
          <span className={styles.sliderValue}>{allMotorsValue}%</span>
        </div>

        {/* Individual motor sliders */}
        {Array.from({ length: motorCount }, (_, i) => (
          <div key={`motor-${i}`} className={styles.sliderRow}>
            <span className={styles.sliderLabel}>Motor {i + 1}</span>
            {channelNames[i] && <span className={styles.sliderFnLabel}>{channelNames[i]}</span>}
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={100}
              step={5}
              value={motorValues[i] ?? 0}
              onChange={(e) => handleMotorChange(i, Number(e.target.value))}
              disabled={controlsDisabled}
            />
            <span className={styles.sliderValue}>{motorValues[i] ?? 0}%</span>
          </div>
        ))}
      </div>

      {/* Servo Test Section */}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Servo Test</span>

        {Array.from({ length: DEFAULT_SERVO_COUNT }, (_, i) => (
          <div key={`servo-${i}`} className={styles.sliderRow}>
            <span className={styles.sliderLabel}>Servo {i + 1}</span>
            {channelNames[i] && <span className={styles.sliderFnLabel}>{channelNames[i]}</span>}
            <input
              className={styles.slider}
              type="range"
              min={SERVO_MIN}
              max={SERVO_MAX}
              step={10}
              value={servoValues[i] ?? SERVO_CENTER}
              onChange={(e) => handleServoChange(i, Number(e.target.value))}
              disabled={controlsDisabled}
            />
            <span className={styles.sliderValue}>{servoValues[i] ?? SERVO_CENTER} us</span>
            <button
              className={styles.centerBtn}
              onClick={() => handleServoCenter(i)}
              disabled={controlsDisabled}
            >
              Center
            </button>
          </div>
        ))}
      </div>

      {/* Live Servo Outputs Section */}
      {outputs.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Live Servo Outputs</span>

          {outputs.map((pwm, i) => {
            const pct = Math.max(
              0,
              Math.min(100, ((pwm - SERVO_MIN) / (SERVO_MAX - SERVO_MIN)) * 100)
            )
            return (
              <div key={`output-${i}`} className={styles.outputRow}>
                <span className={styles.outputLabel}>CH{i + 1}</span>
                {channelNames[i] && <span className={styles.outputFnLabel}>{channelNames[i]}</span>}
                <div className={styles.outputBarContainer}>
                  <div className={styles.outputBar} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.outputValue}>{pwm} us</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
