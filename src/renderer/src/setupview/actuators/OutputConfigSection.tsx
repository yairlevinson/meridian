import { useState, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { SERVO_FUNCTIONS, FUNCTION_OPTIONS } from './servoFunctions'
import styles from './ActuatorsPage.module.css'

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
      await bridge.parametersSet(vehicleId, name, value)
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
