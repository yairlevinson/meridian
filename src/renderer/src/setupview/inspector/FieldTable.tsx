import { useMavInspectorStore } from '../../store/mavInspectorStore'
import styles from './MavInspectorView.module.css'

export function FieldTable(): React.JSX.Element {
  const selectedKey = useMavInspectorStore((s) => s.selectedKey)
  const selectedFields = useMavInspectorStore((s) => s.selectedFields)
  const messages = useMavInspectorStore((s) => s.messages)

  if (!selectedKey) {
    return (
      <div className={styles.fieldPanel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>Select a Message</div>
          <div className={styles.emptyMsg}>Click a message on the left to inspect its fields</div>
        </div>
      </div>
    )
  }

  const msg = messages.find((m) => `${m.sysid}:${m.compid}:${m.msgid}` === selectedKey)

  return (
    <div className={styles.fieldPanel}>
      {msg && (
        <div className={styles.fieldHeader}>
          <span className={styles.fieldMsgName}>{msg.name}</span>
          <span className={styles.fieldMsgMeta}>
            ID {msg.msgid} &middot; Sys {msg.sysid} &middot; Comp {msg.compid} &middot; {msg.rateHz}{' '}
            Hz &middot; {msg.count} total
          </span>
        </div>
      )}
      {selectedFields.length === 0 ? (
        <div className={styles.emptyMsg}>Waiting for field data...</div>
      ) : (
        <table className={styles.fieldTable}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {selectedFields.map((f) => (
              <tr key={f.name}>
                <td className={styles.fieldName}>{f.name}</td>
                <td className={styles.fieldValue}>{f.value}</td>
                <td className={styles.fieldType}>{f.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
