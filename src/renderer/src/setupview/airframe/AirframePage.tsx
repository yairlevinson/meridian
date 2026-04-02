import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import styles from './AirframePage.module.css'

/** ArduCopter FRAME_CLASS values */
const FRAME_CLASSES: Record<number, string> = {
  0: 'Undefined',
  1: 'Quad',
  2: 'Hexa',
  3: 'Octa',
  4: 'OctaQuad',
  5: 'Y6',
  6: 'Heli',
  7: 'Tri',
  10: 'Single/Coax',
  11: 'Coax',
  13: 'HeliQuad',
  14: 'DodecaHexa',
  15: 'HeliDual'
}

/** ArduCopter FRAME_TYPE values */
const FRAME_TYPES: Record<number, string> = {
  0: 'Plus (+)',
  1: 'X',
  2: 'V',
  3: 'H',
  4: 'V-Tail',
  5: 'A-Tail',
  10: 'Y6B',
  11: 'Y6F',
  12: 'BetaFlightX',
  13: 'DJIX',
  14: 'ClockwiseX',
  18: 'BetaFlightXReversed'
}

export function AirframePage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const savedFrameClass = parameters.get('FRAME_CLASS')?.value ?? 0
  const savedFrameType = parameters.get('FRAME_TYPE')?.value ?? 0

  const [frameClass, setFrameClass] = useState(savedFrameClass)
  const [frameType, setFrameType] = useState(savedFrameType)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setFrameClass(savedFrameClass)
    setFrameType(savedFrameType)
    setHasChanges(false)
  }, [savedFrameClass, savedFrameType])

  const frameClassOptions = useMemo(
    () =>
      Object.entries(FRAME_CLASSES)
        .map(([val, name]) => ({ value: Number(val), label: `${val} - ${name}` }))
        .sort((a, b) => a.value - b.value),
    []
  )

  const frameTypeOptions = useMemo(
    () =>
      Object.entries(FRAME_TYPES)
        .map(([val, name]) => ({ value: Number(val), label: `${val} - ${name}` }))
        .sort((a, b) => a.value - b.value),
    []
  )

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    await bridge.setParameter(vehicleId, 'FRAME_CLASS', frameClass)
    await bridge.setParameter(vehicleId, 'FRAME_TYPE', frameType)
    setHasChanges(false)
  }, [vehicleId, frameClass, frameType])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Airframe</div>
        <ParameterLoading />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Airframe</div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Frame Class</label>
        <select
          className={styles.select}
          value={frameClass}
          onChange={(e) => {
            setFrameClass(Number(e.target.value))
            setHasChanges(true)
          }}
        >
          {frameClassOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.paramName}>FRAME_CLASS</span>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Frame Type</label>
        <select
          className={styles.select}
          value={frameType}
          onChange={(e) => {
            setFrameType(Number(e.target.value))
            setHasChanges(true)
          }}
        >
          {frameTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.paramName}>FRAME_TYPE</span>
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>Save</button>
          <button
            className={styles.cancelBtn}
            onClick={() => {
              setFrameClass(savedFrameClass)
              setFrameType(savedFrameType)
              setHasChanges(false)
            }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
