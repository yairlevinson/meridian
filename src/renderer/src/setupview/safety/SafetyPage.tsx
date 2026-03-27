import { useState, useEffect, useCallback } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import styles from './SafetyPage.module.css'

const SAFETY_PARAMS = [
  { name: 'FS_THR_ENABLE', label: 'Throttle Failsafe', description: '0=disabled, 1=always RTL, 2=continue in Auto, 3=always Land' },
  { name: 'FS_THR_VALUE', label: 'Throttle FS PWM', description: 'PWM value below which failsafe triggers (default 975)' },
  { name: 'FS_BATT_ENABLE', label: 'Battery Failsafe', description: '0=disabled, 1=Land, 2=RTL' },
  { name: 'FS_BATT_VOLTAGE', label: 'Battery FS Voltage', description: 'Minimum voltage before failsafe (0=disabled)' },
  { name: 'FS_BATT_MAH', label: 'Battery FS mAh', description: 'Minimum remaining mAh before failsafe (0=disabled)' },
  { name: 'FS_GCS_ENABLE', label: 'GCS Failsafe', description: '0=disabled, 1=RTL, 2=continue in Auto' },
  { name: 'FENCE_ENABLE', label: 'Geofence Enable', description: '0=disabled, 1=enabled' },
  { name: 'FENCE_TYPE', label: 'Fence Type', description: '1=altitude, 2=circle, 3=both' },
  { name: 'FENCE_ALT_MAX', label: 'Fence Max Altitude', description: 'Maximum altitude in meters' },
  { name: 'FENCE_RADIUS', label: 'Fence Radius', description: 'Circular fence radius in meters' },
  { name: 'FENCE_ACTION', label: 'Fence Action', description: '0=report, 1=RTL/Land, 2=always Land' },
  { name: 'ARMING_CHECK', label: 'Arming Checks', description: 'Bitmask of pre-arm checks (0=disabled, 1=all)' }
] as const

export function SafetyPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

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
    const bridge = window.qgcBridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.setParameter(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Safety</div>
        <div className={styles.loading}>Waiting for parameters...</div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Safety</div>
      <div className={styles.paramList}>
        {SAFETY_PARAMS.map((p) => {
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
