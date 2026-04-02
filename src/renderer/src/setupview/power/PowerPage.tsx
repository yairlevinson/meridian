import { useState, useEffect, useCallback } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import styles from './PowerPage.module.css'

const POWER_PARAMS = [
  { name: 'BATT_MONITOR', label: 'Battery Monitor', description: 'Monitor type (0=disabled, 3=analog V+I, 4=analog V)' },
  { name: 'BATT_CAPACITY', label: 'Battery Capacity', description: 'Capacity in mAh' },
  { name: 'BATT_VOLT_PIN', label: 'Voltage Pin', description: 'Analog pin for voltage sensing' },
  { name: 'BATT_CURR_PIN', label: 'Current Pin', description: 'Analog pin for current sensing' },
  { name: 'BATT_VOLT_MULT', label: 'Voltage Multiplier', description: 'Scaling factor for voltage reading' },
  { name: 'BATT_AMP_PERVLT', label: 'Amps Per Volt', description: 'Current sensor scaling' },
  { name: 'BATT_ARM_VOLT', label: 'Arm Voltage Min', description: 'Minimum voltage to allow arming (0=disabled)' },
  { name: 'BATT_ARM_MAH', label: 'Arm Capacity Min', description: 'Minimum remaining mAh to allow arming (0=disabled)' }
] as const

export function PowerPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

  // Reset edits when parameters reload
  useEffect(() => {
    setEdits({})
  }, [loadState.parametersReady])

  const handleChange = useCallback((name: string, value: string) => {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      setEdits((prev) => ({ ...prev, [name]: num }))
    }
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.setParameter(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Power</div>
        <ParameterLoading />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Power</div>
      <div className={styles.paramList}>
        {POWER_PARAMS.map((p) => {
          const param = parameters.get(p.name)
          const currentValue = edits[p.name] ?? param?.value
          const isModified = p.name in edits
          return (
            <div key={p.name} className={styles.paramRow}>
              <div className={styles.paramInfo}>
                <span className={`${styles.paramName} ${isModified ? styles.paramModified : ''}`}>
                  {p.label}
                </span>
                <span className={styles.paramDesc}>{p.description}</span>
              </div>
              <input
                className={styles.paramInput}
                type="number"
                step="any"
                value={currentValue ?? ''}
                disabled={!param}
                onChange={(e) => handleChange(p.name, e.target.value)}
              />
            </div>
          )
        })}
      </div>
      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>Save</button>
          <button className={styles.cancelBtn} onClick={() => setEdits({})}>Discard</button>
        </div>
      )}
    </div>
  )
}
