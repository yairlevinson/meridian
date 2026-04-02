import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import styles from './TuningPage.module.css'

/** PID tuning parameter groups for ArduCopter */
const TUNING_GROUPS: Array<{
  label: string
  description: string
  params: Array<{ name: string; label: string }>
}> = [
  {
    label: 'Roll Rate',
    description: 'ATC_RAT_RLL — Roll axis rate controller',
    params: [
      { name: 'ATC_RAT_RLL_P', label: 'P' },
      { name: 'ATC_RAT_RLL_I', label: 'I' },
      { name: 'ATC_RAT_RLL_D', label: 'D' },
      { name: 'ATC_RAT_RLL_FF', label: 'FF' },
      { name: 'ATC_RAT_RLL_FLTD', label: 'D Filter' },
      { name: 'ATC_RAT_RLL_FLTT', label: 'T Filter' },
      { name: 'ATC_RAT_RLL_IMAX', label: 'I Max' }
    ]
  },
  {
    label: 'Pitch Rate',
    description: 'ATC_RAT_PIT — Pitch axis rate controller',
    params: [
      { name: 'ATC_RAT_PIT_P', label: 'P' },
      { name: 'ATC_RAT_PIT_I', label: 'I' },
      { name: 'ATC_RAT_PIT_D', label: 'D' },
      { name: 'ATC_RAT_PIT_FF', label: 'FF' },
      { name: 'ATC_RAT_PIT_FLTD', label: 'D Filter' },
      { name: 'ATC_RAT_PIT_FLTT', label: 'T Filter' },
      { name: 'ATC_RAT_PIT_IMAX', label: 'I Max' }
    ]
  },
  {
    label: 'Yaw Rate',
    description: 'ATC_RAT_YAW — Yaw axis rate controller',
    params: [
      { name: 'ATC_RAT_YAW_P', label: 'P' },
      { name: 'ATC_RAT_YAW_I', label: 'I' },
      { name: 'ATC_RAT_YAW_D', label: 'D' },
      { name: 'ATC_RAT_YAW_FF', label: 'FF' },
      { name: 'ATC_RAT_YAW_FLTD', label: 'D Filter' },
      { name: 'ATC_RAT_YAW_FLTT', label: 'T Filter' },
      { name: 'ATC_RAT_YAW_IMAX', label: 'I Max' }
    ]
  },
  {
    label: 'Position XY',
    description: 'PSC_POSXY — Horizontal position controller',
    params: [
      { name: 'PSC_POSXY_P', label: 'P' }
    ]
  },
  {
    label: 'Velocity XY',
    description: 'PSC_VELXY — Horizontal velocity controller',
    params: [
      { name: 'PSC_VELXY_P', label: 'P' },
      { name: 'PSC_VELXY_I', label: 'I' },
      { name: 'PSC_VELXY_D', label: 'D' },
      { name: 'PSC_VELXY_FF', label: 'FF' },
      { name: 'PSC_VELXY_IMAX', label: 'I Max' },
      { name: 'PSC_VELXY_FLTD', label: 'D Filter' },
      { name: 'PSC_VELXY_FLTE', label: 'E Filter' }
    ]
  },
  {
    label: 'Position Z',
    description: 'PSC_POSZ — Vertical position controller',
    params: [
      { name: 'PSC_POSZ_P', label: 'P' }
    ]
  },
  {
    label: 'Velocity Z',
    description: 'PSC_VELZ — Vertical velocity controller',
    params: [
      { name: 'PSC_VELZ_P', label: 'P' }
    ]
  },
  {
    label: 'Accel Z',
    description: 'PSC_ACCZ — Vertical acceleration controller',
    params: [
      { name: 'PSC_ACCZ_P', label: 'P' },
      { name: 'PSC_ACCZ_I', label: 'I' },
      { name: 'PSC_ACCZ_D', label: 'D' },
      { name: 'PSC_ACCZ_FF', label: 'FF' },
      { name: 'PSC_ACCZ_IMAX', label: 'I Max' },
      { name: 'PSC_ACCZ_FLTD', label: 'D Filter' },
      { name: 'PSC_ACCZ_FLTE', label: 'E Filter' }
    ]
  }
]

export function TuningPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const hasChanges = Object.keys(edits).length > 0

  useEffect(() => {
    setEdits({})
  }, [loadState.parametersReady])

  const handleChange = useCallback((name: string, value: string) => {
    const num = parseFloat(value)
    if (!isNaN(num)) {
      setEdits((prev) => ({ ...prev, [name]: num }))
    }
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.setParameter(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  // Filter to only show groups that have at least one parameter present
  const availableGroups = useMemo(() => {
    return TUNING_GROUPS.filter((g) => g.params.some((p) => parameters.has(p.name)))
  }, [parameters])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>PID Tuning</div>
        <ParameterLoading />
      </div>
    )
  }

  if (availableGroups.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>PID Tuning</div>
        <div className={styles.loading}>No tuning parameters found — vehicle may not support PID tuning or parameters are still loading.</div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>PID Tuning</div>

      <div className={styles.groupList}>
        {availableGroups.map((group) => {
          const isExpanded = expandedGroup === group.label
          return (
            <div key={group.label} className={styles.group}>
              <button
                className={`${styles.groupHeader} ${isExpanded ? styles.groupHeaderActive : ''}`}
                onClick={() => setExpandedGroup(isExpanded ? null : group.label)}
              >
                <span className={styles.groupLabel}>{group.label}</span>
                <span className={styles.groupDesc}>{group.description}</span>
                <span className={styles.groupChevron}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
              </button>
              {isExpanded && (
                <div className={styles.paramGrid}>
                  {group.params.map((p) => {
                    const param = parameters.get(p.name)
                    if (!param) return null
                    const currentValue = edits[p.name] ?? param.value
                    const isModified = p.name in edits
                    return (
                      <div key={p.name} className={styles.paramRow}>
                        <span className={`${styles.paramLabel} ${isModified ? styles.paramModified : ''}`}>
                          {p.label}
                        </span>
                        <input
                          className={styles.paramInput}
                          type="number"
                          step="any"
                          value={currentValue}
                          onChange={(e) => handleChange(p.name, e.target.value)}
                        />
                        <span className={styles.paramName}>{p.name}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save ({Object.keys(edits).length})
          </button>
          <button className={styles.cancelBtn} onClick={() => setEdits({})}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
