import { useEffect, useMemo } from 'react'
import { useMavInspectorStore } from '../../store/mavInspectorStore'
import { MessageList } from './MessageList'
import { FieldTable } from './FieldTable'
import styles from './MavInspectorView.module.css'

export function MavInspectorView(): React.JSX.Element {
  const open = useMavInspectorStore((s) => s.open)
  const close = useMavInspectorStore((s) => s.close)
  const messages = useMavInspectorStore((s) => s.messages)
  const filterSysid = useMavInspectorStore((s) => s.filterSysid)
  const filterCompid = useMavInspectorStore((s) => s.filterCompid)
  const setFilterSysid = useMavInspectorStore((s) => s.setFilterSysid)
  const setFilterCompid = useMavInspectorStore((s) => s.setFilterCompid)

  useEffect(() => {
    open()
    return () => close()
  }, [open, close])

  const sysids = useMemo(() => {
    const set = new Set(messages.map((m) => m.sysid))
    return Array.from(set).sort((a, b) => a - b)
  }, [messages])

  const compids = useMemo(() => {
    const set = new Set(messages.map((m) => m.compid))
    return Array.from(set).sort((a, b) => a - b)
  }, [messages])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>MAVLink Inspector</span>
        <div className={styles.spacer} />
        <select
          className={styles.filterSelect}
          value={filterSysid ?? ''}
          onChange={(e) => setFilterSysid(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All Systems</option>
          {sysids.map((id) => (
            <option key={id} value={id}>
              System {id}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={filterCompid ?? ''}
          onChange={(e) => setFilterCompid(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All Components</option>
          {compids.map((id) => (
            <option key={id} value={id}>
              Comp {id}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.body}>
        <MessageList />
        <FieldTable />
      </div>
    </div>
  )
}
