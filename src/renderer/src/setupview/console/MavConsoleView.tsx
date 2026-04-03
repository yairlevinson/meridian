import { useState, useRef, useEffect, useCallback } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import styles from './MavConsoleView.module.css'

const MAX_OUTPUT_LENGTH = 50000

export function MavConsoleView(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Subscribe to console data from the autopilot
  useEffect(() => {
    const bridge = window.bridge
    if (!bridge?.onMavConsoleData) return

    const unsub = bridge.onMavConsoleData((payload) => {
      if (activeVehicleId != null && payload.vehicleId !== activeVehicleId) return
      setOutput((prev) => {
        const next = prev + payload.text
        // Trim if output gets too large
        return next.length > MAX_OUTPUT_LENGTH
          ? next.slice(next.length - MAX_OUTPUT_LENGTH)
          : next
      })
    })

    return unsub
  }, [activeVehicleId])

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || activeVehicleId == null) return

    // Add to history
    setHistory((prev) => {
      const next = prev.filter((h) => h !== text)
      next.push(text)
      return next.slice(-100)
    })
    setHistoryIndex(-1)
    setInput('')

    try {
      await window.bridge?.mavConsoleWrite(activeVehicleId, text)
    } catch (err) {
      setOutput((prev) => prev + `\n[Error sending command: ${err}]\n`)
    }
  }, [input, activeVehicleId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSend()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (history.length === 0) return
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInput(history[newIndex]!)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex === -1) return
        const newIndex = historyIndex + 1
        if (newIndex >= history.length) {
          setHistoryIndex(-1)
          setInput('')
        } else {
          setHistoryIndex(newIndex)
          setInput(history[newIndex]!)
        }
      }
    },
    [handleSend, history, historyIndex]
  )

  if (activeVehicleId == null) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>No vehicle connected</div>
          <div className={styles.emptyMsg}>
            Connect to a vehicle to use the MAVLink console
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>MAVLink Console</span>
        <div className={styles.spacer} />
        <button
          className={styles.clearBtn}
          onClick={() => setOutput('')}
        >
          Clear
        </button>
      </div>
      <div ref={outputRef} className={styles.output}>
        {output}
      </div>
      <div className={styles.inputRow}>
        <span className={styles.prompt}>$</span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setHistoryIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter command..."
          autoFocus
        />
      </div>
    </div>
  )
}
