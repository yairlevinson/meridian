import { useState, useRef, useEffect } from 'react'
import { useTelemetry } from '../hooks/useVehicle'
import { useCommand } from '../hooks/useCommand'
import styles from './FlightModeButton.module.css'

// ArduCopter mode numbers
const COPTER_MODES: { name: string; value: number }[] = [
  { name: 'Stabilize', value: 0 },
  { name: 'Auto', value: 3 },
  { name: 'Guided', value: 4 },
  { name: 'RTL', value: 6 },
  { name: 'Land', value: 9 }
]

export function FlightModeButton(): React.JSX.Element {
  const core = useTelemetry('core')
  const { setFlightMode } = useCommand()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const modeName = core?.flightModeName || (core?.flightMode != null ? `Unknown` : 'Mode ---')

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
          {COPTER_MODES.map((m) => (
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
