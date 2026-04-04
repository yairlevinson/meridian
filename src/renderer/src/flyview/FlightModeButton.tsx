import { useState, useRef, useEffect, useMemo } from 'react'
import { useTelemetry } from '../hooks/useVehicle'
import { useCommand } from '../hooks/useCommand'
import { getModeNamesForVehicleType, mavTypeToVehicleType } from '@shared/ipc/SetupTypes'
import styles from './FlightModeButton.module.css'

export function FlightModeButton(): React.JSX.Element {
  const core = useTelemetry('core')
  const { setFlightMode } = useCommand()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const modeName = core?.flightModeName || (core?.flightMode != null ? `Unknown` : 'Mode ---')

  const modes = useMemo(() => {
    const vehicleType = mavTypeToVehicleType(core?.vehicleType ?? 2)
    const modeNames = getModeNamesForVehicleType(vehicleType)
    return Object.entries(modeNames).map(([value, name]) => ({
      name,
      value: Number(value)
    }))
  }, [core?.vehicleType])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className={styles.root}>
      <button
        onClick={() => setOpen(!open)}
        className={styles.trigger}
        title="Click to change flight mode"
      >
        {modeName} ▾
      </button>
      {open && (
        <div className={styles.dropdown}>
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => {
                setFlightMode(String(m.value))
                setOpen(false)
              }}
              className={`${styles.option} ${core?.flightMode === m.value ? styles.optionActive : ''}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
