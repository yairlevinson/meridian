import { useState, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import styles from './ActuatorsPage.module.css'

/** ArduPilot SERVOx_FUNCTION enum values → display labels */
const SERVO_FUNCTIONS: Record<number, string> = {
  '-1': 'GPIO',
  0: 'Disabled',
  1: 'RCPassThru',
  2: 'Flap',
  3: 'FlapAuto',
  4: 'Aileron',
  6: 'Mount1Yaw',
  7: 'Mount1Pitch',
  8: 'Mount1Roll',
  9: 'Mount1Retract',
  10: 'CameraTrigger',
  12: 'Mount2Yaw',
  13: 'Mount2Pitch',
  14: 'Mount2Roll',
  16: 'DifferentialSpoilerLeft1',
  17: 'DifferentialSpoilerRight1',
  19: 'Elevator',
  21: 'Rudder',
  22: 'SprayerPump',
  23: 'SprayerSpinner',
  24: 'FlaperonLeft',
  25: 'FlaperonRight',
  26: 'GroundSteering',
  27: 'Parachute',
  28: 'Gripper',
  29: 'LandingGear',
  30: 'EngineRunEnable',
  31: 'HeliRSC',
  32: 'HeliTailRSC',
  33: 'Motor1',
  34: 'Motor2',
  35: 'Motor3',
  36: 'Motor4',
  37: 'Motor5',
  38: 'Motor6',
  39: 'Motor7',
  40: 'Motor8',
  41: 'TiltMotorFront',
  46: 'TiltMotorRear',
  51: 'RCIN1',
  52: 'RCIN2',
  53: 'RCIN3',
  54: 'RCIN4',
  55: 'RCIN5',
  56: 'RCIN6',
  57: 'RCIN7',
  58: 'RCIN8',
  59: 'RCIN9',
  60: 'RCIN10',
  61: 'RCIN11',
  62: 'RCIN12',
  63: 'RCIN13',
  64: 'RCIN14',
  65: 'RCIN15',
  66: 'RCIN16',
  73: 'ThrottleLeft',
  74: 'ThrottleRight',
  75: 'TiltMotorFrontLeft',
  76: 'TiltMotorFrontRight',
  81: 'BoostThrottle',
  82: 'Motor9',
  83: 'Motor10',
  84: 'Motor11',
  85: 'Motor12',
  88: 'Winch',
  94: 'Main Sail',
  120: 'NeoPixel1',
  121: 'NeoPixel2',
  122: 'NeoPixel3',
  123: 'NeoPixel4',
  124: 'DShot',
  125: 'ProfiLED1',
  126: 'ProfiLED2',
  127: 'ProfiLED3',
  129: 'ProfiLEDClock',
  132: 'Alarm',
  133: 'AlarmInverted',
  134: 'RCIN16Scaled',
  135: 'RCIN17Scaled',
  136: 'TorqeedoThrottle',
  138: 'Scripting1',
  139: 'Scripting2',
  140: 'Scripting3',
  141: 'Scripting4'
}

/** Sorted function entries for dropdown */
const FUNCTION_OPTIONS = Object.entries(SERVO_FUNCTIONS)
  .map(([value, label]) => ({ value: Number(value), label: `${label} (${value})` }))
  .sort((a, b) => a.value - b.value)

export function OutputConfigSection(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

  // Discover servo channel count by checking which SERVOx_FUNCTION params exist
  const servoCount = useMemo(() => {
    let count = 0
    for (let i = 1; i <= 16; i++) {
      if (parameters.has(`SERVO${i}_FUNCTION`)) {
        count = i
      } else {
        break
      }
    }
    return count
  }, [parameters])

  const handleChange = useCallback((paramName: string, value: number) => {
    setEdits((prev) => ({ ...prev, [paramName]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.setParameter(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  const handleDiscard = useCallback(() => {
    setEdits({})
  }, [])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Output Configuration</span>
        <div className={styles.configLoading}>Waiting for parameters...</div>
      </div>
    )
  }

  if (servoCount === 0) {
    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Output Configuration</span>
        <div className={styles.configLoading}>No SERVO parameters found</div>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Output Configuration</span>
        {hasChanges && (
          <div className={styles.configActions}>
            <button className={styles.saveBtn} onClick={handleSave}>
              Save
            </button>
            <button className={styles.discardBtn} onClick={handleDiscard}>
              Discard
            </button>
          </div>
        )}
      </div>

      <div className={styles.configTable}>
        {/* Header row */}
        <div className={styles.configHeaderRow}>
          <span className={styles.configColChannel}>Channel</span>
          <span className={styles.configColFunction}>Function</span>
          <span className={styles.configColNum}>Min</span>
          <span className={styles.configColNum}>Max</span>
          <span className={styles.configColNum}>Trim</span>
          <span className={styles.configColRev}>Rev</span>
        </div>

        {/* Data rows */}
        {Array.from({ length: servoCount }, (_, i) => {
          const ch = i + 1
          const prefix = `SERVO${ch}_`

          const getVal = (suffix: string): number | undefined => {
            const name = `${prefix}${suffix}`
            return name in edits ? edits[name] : parameters.get(name)?.value
          }

          const isEdited = (suffix: string): boolean => `${prefix}${suffix}` in edits

          const fnVal = getVal('FUNCTION') ?? 0
          const minVal = getVal('MIN') ?? 1000
          const maxVal = getVal('MAX') ?? 2000
          const trimVal = getVal('TRIM') ?? 1500
          const revVal = getVal('REVERSED') ?? 0

          return (
            <div key={ch} className={styles.configRow}>
              <span className={styles.configColChannel}>SERVO {ch}</span>

              <select
                className={`${styles.configSelect} ${isEdited('FUNCTION') ? styles.configEdited : ''}`}
                value={fnVal}
                onChange={(e) => handleChange(`${prefix}FUNCTION`, Number(e.target.value))}
              >
                {FUNCTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                {/* Show raw value if not in our enum */}
                {!(fnVal in SERVO_FUNCTIONS) && <option value={fnVal}>Unknown ({fnVal})</option>}
              </select>

              <input
                className={`${styles.configNumInput} ${isEdited('MIN') ? styles.configEdited : ''}`}
                type="number"
                min={800}
                max={2200}
                value={minVal}
                onChange={(e) => handleChange(`${prefix}MIN`, Number(e.target.value))}
              />

              <input
                className={`${styles.configNumInput} ${isEdited('MAX') ? styles.configEdited : ''}`}
                type="number"
                min={800}
                max={2200}
                value={maxVal}
                onChange={(e) => handleChange(`${prefix}MAX`, Number(e.target.value))}
              />

              <input
                className={`${styles.configNumInput} ${isEdited('TRIM') ? styles.configEdited : ''}`}
                type="number"
                min={800}
                max={2200}
                value={trimVal}
                onChange={(e) => handleChange(`${prefix}TRIM`, Number(e.target.value))}
              />

              <input
                className={styles.configCheckbox}
                type="checkbox"
                checked={revVal === 1}
                onChange={(e) => handleChange(`${prefix}REVERSED`, e.target.checked ? 1 : 0)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
