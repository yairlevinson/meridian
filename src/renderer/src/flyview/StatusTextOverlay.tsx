import { useEffect, useRef, useState } from 'react'
import { rlog } from '../lib/rlog'
import styles from './StatusTextOverlay.module.css'

const log = rlog('StatusText')

interface StatusMessage {
  id: number
  severity: number
  text: string
  timestamp: number
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

let nextId = 0

export function StatusTextOverlay(): React.JSX.Element {
  const [messages, setMessages] = useState<StatusMessage[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (typeof window === 'undefined' || !window.bridge) return
    const unsubscribe = window.bridge.onStatusText(({ severity, text }) => {
      log.debug('sev=%d text=%s', severity, text)
      setMessages((prev) => [
        ...prev.slice(-9),
        { id: nextId++, severity, text, timestamp: Date.now() }
      ])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        const filtered = prev.filter((m) => {
          const ttl = SEVERITY_TTL_MS[m.severity] ?? 15000
          return now - m.timestamp < ttl
        })
        return filtered.length === prev.length ? prev : filtered
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const dismiss = (id: number): void => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }

  if (messages.length === 0) return <></>

  return (
    <div className={styles.root}>
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`${styles.message} ${SEVERITY_CLASS[msg.severity] ?? styles.sevNotice}`}
        >
          <span className={styles.icon}>{SEVERITY_ICONS[msg.severity] ?? '\u2022'}</span>
          <span className={styles.text}>{msg.text}</span>
          <span className={styles.dismiss} onClick={() => dismiss(msg.id)}>
            {'\u2715'}
          </span>
        </div>
      ))}
    </div>
  )
}
