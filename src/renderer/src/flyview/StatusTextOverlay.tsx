import { useEffect, useRef, useState } from 'react'
import styles from './StatusTextOverlay.module.css'

interface StatusMessage {
  id: number
  severity: number
  text: string
  timestamp: number
}

const SEVERITY_COLORS: Record<number, string> = {
  0: '#ff0000', // EMERGENCY
  1: '#ff0000', // ALERT
  2: '#ff4444', // CRITICAL
  3: '#ff6644', // ERROR
  4: '#ffaa00', // WARNING
  5: '#aaaaaa', // NOTICE
  6: '#00ff88', // INFO
  7: '#666666' // DEBUG
}

const SEVERITY_TTL_MS: Record<number, number> = {
  0: 30000, 1: 30000, 2: 30000, 3: 30000, // EMERGENCY..ERROR
  4: 15000, 5: 15000,                       // WARNING, NOTICE
  6: 5000, 7: 5000                           // INFO, DEBUG
}

let nextId = 0

export function StatusTextOverlay(): React.JSX.Element {
  const [messages, setMessages] = useState<StatusMessage[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (typeof window === 'undefined' || !window.bridge) return
    const unsubscribe = window.bridge.onStatusText(({ severity, text }) => {
      setMessages((prev) => [...prev.slice(-19), { id: nextId++, severity, text, timestamp: Date.now() }])
    })
    return unsubscribe
  }, [])

  // Expire messages based on severity TTL
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

  if (messages.length === 0) return <></>

  return (
    <div className={styles.root}>
      {messages.map((msg) => (
        <div key={msg.id} style={{ color: SEVERITY_COLORS[msg.severity] ?? '#aaa' }}>
          {msg.text}
        </div>
      ))}
    </div>
  )
}
