import { useState, useMemo, useCallback } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterRow } from './ParameterRow'
import styles from './ParameterEditorPage.module.css'

/** Extract group prefix from parameter name (e.g. "BATT" from "BATT_CAPACITY") */
function groupPrefix(name: string): string {
  const idx = name.indexOf('_')
  return idx > 0 ? name.substring(0, idx) : name
}

export function ParameterEditorPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const [search, setSearch] = useState('')
  const [pendingChanges, setPendingChanges] = useState<Map<string, number>>(new Map())

  const vehicleId = activeVehicleId ?? 1

  // Filter and group parameters
  const { groups, filteredCount } = useMemo(() => {
    const searchLower = search.toLowerCase()
    const grouped = new Map<string, Array<[string, (typeof parameters extends Map<string, infer V> ? V : never)]>>()
    let count = 0

    for (const [name, param] of parameters) {
      if (searchLower && !name.toLowerCase().includes(searchLower)) continue
      const group = groupPrefix(name)
      let list = grouped.get(group)
      if (!list) {
        list = []
        grouped.set(group, list)
      }
      list.push([name, param])
      count++
    }

    // Sort groups alphabetically
    const sorted = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    return { groups: sorted, filteredCount: count }
  }, [parameters, search])

  const handleValueChange = useCallback((name: string, value: number) => {
    setPendingChanges((prev) => {
      const next = new Map(prev)
      next.set(name, value)
      return next
    })
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.qgcBridge
    if (!bridge) return
    for (const [name, value] of pendingChanges) {
      await bridge.setParameter(vehicleId, name, value)
    }
    setPendingChanges(new Map())
  }, [pendingChanges, vehicleId])

  const handleRefresh = useCallback(() => {
    window.qgcBridge?.refreshParameters(vehicleId)
  }, [vehicleId])

  const isLoading = !loadState.parametersReady && loadState.totalCount > 0

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search parameters..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={styles.btn} onClick={handleRefresh}>
          Refresh
        </button>
        {pendingChanges.size > 0 && (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save ({pendingChanges.size})
          </button>
        )}
      </div>

      {isLoading && (
        <div className={styles.loadingBar}>
          <div
            className={styles.loadingFill}
            style={{ width: `${(loadState.loadProgress * 100).toFixed(0)}%` }}
          />
        </div>
      )}

      <div className={styles.stats}>
        {loadState.parametersReady
          ? `${filteredCount} of ${parameters.size} parameters`
          : `Loading: ${loadState.receivedCount} / ${loadState.totalCount > 0 ? loadState.totalCount : '?'}`}
      </div>

      <div className={styles.tableWrap}>
        {parameters.size === 0 ? (
          <div className={styles.emptyMsg}>
            {loadState.totalCount === 0
              ? 'No vehicle connected — parameters will load automatically on connect'
              : 'Loading parameters...'}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>NAME</th>
                <th>VALUE</th>
                <th>RANGE / UNITS</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, params]) => (
                <GroupRows
                  key={group}
                  group={group}
                  params={params}
                  pendingChanges={pendingChanges}
                  onValueChange={handleValueChange}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function GroupRows({
  group,
  params,
  pendingChanges,
  onValueChange
}: {
  group: string
  params: Array<[string, { name: string; value: number; type: number; index: number; componentId: number }]>
  pendingChanges: Map<string, number>
  onValueChange: (name: string, value: number) => void
}): React.JSX.Element {
  return (
    <>
      <tr>
        <td colSpan={3} className={styles.groupHeader}>
          {group}
        </td>
      </tr>
      {params.map(([, param]) => (
        <ParameterRow
          key={param.name}
          param={param}
          pendingValue={pendingChanges.get(param.name)}
          onValueChange={onValueChange}
        />
      ))}
    </>
  )
}
