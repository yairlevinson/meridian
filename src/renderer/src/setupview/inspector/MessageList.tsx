import { useMemo } from 'react'
import { useMavInspectorStore } from '../../store/mavInspectorStore'
import type { InspectorMessageSummary } from '../../../../shared-types/ipc/MavInspectorTypes'
import styles from './MavInspectorView.module.css'

export function MessageList(): React.JSX.Element {
  const messages = useMavInspectorStore((s) => s.messages)
  const selectedKey = useMavInspectorStore((s) => s.selectedKey)
  const filterSysid = useMavInspectorStore((s) => s.filterSysid)
  const filterCompid = useMavInspectorStore((s) => s.filterCompid)
  const selectMessage = useMavInspectorStore((s) => s.selectMessage)

  const filtered = useMemo(() => {
    let list: InspectorMessageSummary[] = messages
    if (filterSysid != null) {
      list = list.filter((m) => m.sysid === filterSysid)
    }
    if (filterCompid != null) {
      list = list.filter((m) => m.compid === filterCompid)
    }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [messages, filterSysid, filterCompid])

  if (filtered.length === 0) {
    return (
      <div className={styles.messageList}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>No Messages</div>
          <div className={styles.emptyMsg}>Waiting for MAVLink data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.messageList}>
      {filtered.map((msg) => {
        const key = `${msg.sysid}:${msg.compid}:${msg.msgid}`
        const isSelected = key === selectedKey
        return (
          <div
            key={key}
            className={`${styles.msgRow} ${isSelected ? styles.msgRowSelected : ''}`}
            onClick={() => selectMessage(msg.sysid, msg.compid, msg.msgid)}
          >
            <span className={styles.msgCompid}>{msg.compid}</span>
            <span className={styles.msgName}>{msg.name}</span>
            <span className={styles.msgRate}>{msg.rateHz} Hz</span>
            <span className={styles.msgCount}>{msg.count}</span>
          </div>
        )
      })}
    </div>
  )
}
