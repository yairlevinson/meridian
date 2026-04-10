import { useEffect, useRef, useState } from 'react'
import { rlog } from '../lib/rlog'
import styles from './StatusTextOverlay.module.css'

const log = rlog('StatusText')

interface StatusMessage {
  id: number
  severity: number
  text: string
  timestamp: number
  count: number
  fading: boolean
}

const SEVERITY_ICONS: Record<number, string> = {
  0: '\u26a0', // EMERGENCY ⚠
  1: '\u26a0', // ALERT
  2: '\u26a0', // CRITICAL
  3: '\u2716', // ERROR ✖
  4: '\u26a0', // WARNING ⚠
  5: '\u2139', // NOTICE ℹ
  6: '\u2139', // INFO ℹ
  7: '\u2022' // DEBUG •
}

const SEVERITY_CLASS: Record<number, string> = {
  0: styles.sevCritical!,
  1: styles.sevCritical!,
  2: styles.sevCritical!,
  3: styles.sevError!,
  4: styles.sevWarning!,
  5: styles.sevNotice!,
  6: styles.sevInfo!,
  7: styles.sevDebug!
}

const SEVERITY_TTL_MS: Record<number, number> = {
  0: 30000,
  1: 30000,
  2: 30000,
  3: 30000,
  4: 15000,
  5: 15000,
  6: 5000,
  7: 5000
}

const MAX_VISIBLE = 3
const FADE_DURATION_MS = 400

let nextId = 0

export function StatusTextOverlay(): React.JSX.Element {
  const [messages, setMessages] = useState<StatusMessage[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (typeof window === 'undefined' || !window.bridge) return
    const unsubscribe = window.bridge.onStatusText(({ severity, text }) => {
      log.debug('sev=%d text=%s', severity, text)
      setMessages((prev) => {
        // Deduplicate: if same text + severity exists, bump its count and timestamp
        const existing = prev.find((m) => m.text === text && m.severity === severity)
        if (existing) {
          return prev.map((m) =>
            m.id === existing.id
              ? { ...m, count: m.count + 1, timestamp: Date.now(), fading: false }
              : m
          )
        }
        return [
          ...prev.slice(-9),
          { id: nextId++, severity, text, timestamp: Date.now(), count: 1, fading: false }
        ]
      })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        let changed = false
        const updated = prev.map((m) => {
          const ttl = SEVERITY_TTL_MS[m.severity] ?? 15000
          if (!m.fading && now - m.timestamp >= ttl) {
            changed = true
            return { ...m, fading: true, timestamp: now }
          }
          return m
        })
        // Remove messages that finished fading
        const filtered = updated.filter((m) => {
          if (m.fading && now - m.timestamp >= FADE_DURATION_MS) {
            changed = true
            return false
          }
          return true
        })
        return changed ? filtered : prev
      })
    }, 200)
    return () => clearInterval(timer)
  }, [])

  const dismiss = (id: number): void => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, fading: true, timestamp: Date.now() } : m))
    )
  }

  if (messages.length === 0) return <></>

  const visible = messages.slice(-MAX_VISIBLE)
  const hiddenCount = messages.length - visible.length

  return (
    <div className={styles.root}>
      {hiddenCount > 0 && <div className={styles.overflow}>+{hiddenCount} more</div>}
      {visible.map((msg) => (
        <div
          key={msg.id}
          className={`${styles.message} ${SEVERITY_CLASS[msg.severity] ?? styles.sevNotice} ${msg.fading ? styles.fadeOut : ''}`}
          onClick={() => dismiss(msg.id)}
        >
          <span className={styles.icon}>{SEVERITY_ICONS[msg.severity] ?? '\u2022'}</span>
          <span className={styles.text}>{msg.text}</span>
          {msg.count > 1 && (
            <span className={styles.badge}>
              {'\u00d7'}
              {msg.count}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
