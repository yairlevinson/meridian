import { useCallback, useState, useEffect } from 'react'
import type { ForwardingState, ForwardingTargetState } from '@shared/ipc/ForwardingTypes'
import styles from './ForwardingSettingsPage.module.css'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ForwardingSettingsPage(): React.JSX.Element {
  const [state, setState] = useState<ForwardingState>({ enabled: false, targets: [] })
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('14551')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.bridge?.forwardingGetState().then(setState)
    const unsub = window.bridge?.onForwardingStateChanged((s) => setState(s))
    return () => {
      unsub?.()
    }
  }, [])

  // Poll stats every 2s when enabled
  useEffect(() => {
    if (!state.enabled) return
    const timer = setInterval(() => {
      window.bridge?.forwardingGetState().then(setState)
    }, 2000)
    return () => clearInterval(timer)
  }, [state.enabled])

  const handleToggleEnabled = useCallback(() => {
    window.bridge?.forwardingSetEnabled(!state.enabled)
  }, [state.enabled])

  const handleAddTarget = useCallback(() => {
    const portNum = parseInt(port, 10)
    if (!host.trim() || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('Enter a valid host and port (1-65535)')
      return
    }
    setError(null)
    window.bridge?.forwardingAddTarget(host.trim(), portNum).catch((err: Error) => {
      setError(err.message)
    })
  }, [host, port])

  const handleRemoveTarget = useCallback((id: string) => {
    window.bridge?.forwardingRemoveTarget(id)
  }, [])

  const handleToggleTarget = useCallback((id: string, enabled: boolean) => {
    window.bridge?.forwardingSetTargetEnabled(id, !enabled)
  }, [])

  const activeCount = state.targets.filter((t) => t.active).length

  return (
    <div className={styles.root}>
      <div className={styles.title}>MAVLink Forwarding</div>
      <div className={styles.description}>
        Forward all MAVLink traffic to additional ground station applications over UDP. External GCS
        apps can also send commands back through Meridian.
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <span className={state.enabled ? styles.statusDotOn : styles.statusDotOff} />
        <span className={state.enabled ? styles.statusTextOn : styles.statusTextOff}>
          {state.enabled
            ? `Forwarding to ${activeCount} target${activeCount !== 1 ? 's' : ''}`
            : 'Forwarding disabled'}
        </span>
        <div className={styles.enableToggle}>
          <button
            className={`${styles.toggleBtn} ${state.enabled ? styles.toggleBtnActive : ''}`}
            onClick={handleToggleEnabled}
          >
            {state.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Add target */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Add Forwarding Target</div>
        <div className={styles.addForm}>
          <input
            className={styles.hostInput}
            type="text"
            value={host}
            placeholder="192.168.1.100"
            disabled={!state.enabled}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
          />
          <input
            className={styles.portInput}
            type="number"
            value={port}
            placeholder="14551"
            min={1}
            max={65535}
            disabled={!state.enabled}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
          />
          <button className={styles.addBtn} disabled={!state.enabled} onClick={handleAddTarget}>
            Add Target
          </button>
        </div>
      </div>

      {/* Target list */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Targets</div>
        <div className={styles.targetList}>
          {state.targets.length === 0 ? (
            <div className={styles.emptyState}>
              No forwarding targets configured. Add a target above to start forwarding.
            </div>
          ) : (
            state.targets.map((target: ForwardingTargetState) => (
              <div key={target.id} className={styles.targetRow}>
                <span className={target.active ? styles.statusDotOn : styles.statusDotOff} />
                <span className={styles.targetAddress}>
                  {target.host}:{target.port}
                </span>
                <span className={styles.targetStats}>
                  TX: {formatBytes(target.bytesForwarded)} ({target.packetsForwarded} pkts)
                  {' | '}
                  RX: {formatBytes(target.bytesReceived)} ({target.packetsReceived} pkts)
                </span>
                <button
                  className={`${styles.targetToggle} ${target.enabled ? styles.targetToggleOn : ''}`}
                  disabled={!state.enabled}
                  onClick={() => handleToggleTarget(target.id, target.enabled)}
                >
                  {target.enabled ? 'On' : 'Off'}
                </button>
                <button
                  className={styles.removeBtn}
                  disabled={!state.enabled}
                  onClick={() => handleRemoveTarget(target.id)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}
