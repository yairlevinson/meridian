import { useEffect, useState } from 'react'
import styles from './StatusTextOverlay.module.css'

interface StatusMessage {
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

export function StatusTextOverlay(): React.JSX.Element {
  const [messages, setMessages] = useState<StatusMessage[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.qgcBridge) return
    const unsubscribe = window.qgcBridge.onStatusText(({ severity, text }) => {
      setMessages((prev) => [...prev.slice(-19), { severity, text, timestamp: Date.now() }])
    })
    return unsubscribe
  }, [])

  if (messages.length === 0) return <></>

  return (
    <div className={styles.root}>
      {messages.map((msg, i) => (
        <div key={i} style={{ color: SEVERITY_COLORS[msg.severity] ?? '#aaa' }}>
          {msg.text}
        </div>
      ))}
    </div>
  )
}
