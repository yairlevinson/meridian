import { useState, useEffect, useCallback } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import styles from './SafetyPage.module.css'

const MAV_AUTOPILOT_PX4 = 12

/* ── Shared helpers ─────────────────────────── */

/** Read a parameter value, preferring local edit */
function getParamVal(
  parameters: Map<string, { value: number }>,
  edits: Record<string, number>,
  name: string
): number | undefined {
  const edited = edits[name]
  if (edited !== undefined) return edited
  return parameters.get(name)?.value
}

function ParamInput({
  label,
  param,
  unit,
  parameters,
  edits,
  onEdit,
  disabled,
  scale
}: {
  label: string
  param: string
  unit?: string
  parameters: Map<string, { value: number }>
  edits: Record<string, number>
  onEdit: (param: string, value: number) => void
  disabled?: boolean
  /** Display multiplier (e.g. 100 to show 0.15 as 15%). Stored value = display / scale */
  scale?: number
}): React.JSX.Element | null {
  const p = parameters.get(param)
  if (!p) return null
  const raw = edits[param] ?? p.value
  const s = scale ?? 1
  const display = raw !== undefined ? Math.round(raw * s * 1000) / 1000 : ''
  const modified = param in edits
  return (
    <div className={styles.paramRow}>
      <span className={`${styles.paramLabel} ${modified ? styles.paramModified : ''}`}>
        {label}
      </span>
      <input
        className={styles.paramInput}
        type="number"
        step="any"
        value={display}
        disabled={disabled}
        onChange={(e) => {
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onEdit(param, n / s)
        }}
      />
      <span className={styles.paramUnit}>{unit ?? ''}</span>
    </div>
  )
}

function ParamSelect({
  label,
  param,
  options,
  parameters,
  edits,
  onEdit
}: {
  label: string
  param: string
  options: Array<{ value: number; label: string }>
  parameters: Map<string, { value: number }>
  edits: Record<string, number>
  onEdit: (param: string, value: number) => void
}): React.JSX.Element | null {
  const p = parameters.get(param)
  if (!p) return null
  const value = edits[param] ?? p.value
  const modified = param in edits
  return (
    <div className={styles.paramRow}>
      <span className={`${styles.paramLabel} ${modified ? styles.paramModified : ''}`}>
        {label}
      </span>
      <select
        className={styles.paramSelect}
        value={value}
        onChange={(e) => onEdit(param, Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ── Card icons ─────────────────────────────── */

const S = 18 // icon size
const iconProps = {
  width: S,
  height: S,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

function IconBattery(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="6" y="4" width="12" height="18" rx="2" />
      <line x1="10" y1="1" x2="14" y2="1" />
      <rect x="8.5" y="14" width="7" height="5" rx="0.5" fill="currentColor" opacity={0.4} />
      <rect x="8.5" y="8" width="7" height="5" rx="0.5" fill="currentColor" opacity={0.2} />
    </svg>
  )
}

function IconRadio(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M12 20v-8" />
      <path d="M8 16a4 4 0 0 1 8 0" />
      <path d="M5 13a8 8 0 0 1 14 0" />
      <path d="M2 10a12 12 0 0 1 20 0" />
      <circle cx="12" cy="20" r="1.5" fill="currentColor" />
    </svg>
  )
}

function IconLink(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  )
}

function IconFence(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.4 5.15-1.25 9-6.15 9-11.4V7l-9-5z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function IconHome(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M12 15v5" />
      <path d="M9 20h6" />
    </svg>
  )
}

function IconLand(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M12 3v12" />
      <polyline points="8 11 12 15 16 11" />
      <line x1="4" y1="21" x2="20" y2="21" />
      <line x1="4" y1="19" x2="6" y2="21" />
      <line x1="8" y1="19" x2="10" y2="21" />
      <line x1="12" y1="19" x2="14" y2="21" />
      <line x1="16" y1="19" x2="18" y2="21" />
    </svg>
  )
}

function IconWarning(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
    </svg>
  )
}

function IconCheck(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function CardIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className={styles.cardIcon}>{children}</span>
}

/* ── PX4 Safety ─────────────────────────────── */

function PX4SafetyPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

  useEffect(() => {
    setEdits({})
  }, [loadState.parametersReady])

  const onEdit = useCallback((param: string, value: number) => {
    setEdits((prev) => ({ ...prev, [param]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.parametersSet(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Safety</div>
        <ParameterLoading />
      </div>
    )
  }

  // RTL land delay logic
  const rtlLandDelay = getParamVal(parameters, edits, 'RTL_LAND_DELAY')
  const rtlMode = rtlLandDelay === 0 ? 'land' : rtlLandDelay === -1 ? 'loiter' : 'loiterLand'

  return (
    <div className={styles.root}>
      <div className={styles.title}>Safety</div>
      <div className={styles.cardGrid}>
        {/* Low Battery Failsafe */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconBattery />
            </CardIcon>
            Low Battery Failsafe
          </div>
          <ParamSelect
            label="Failsafe action"
            param="COM_LOW_BAT_ACT"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Warning' },
              { value: 2, label: 'Land' },
              { value: 3, label: 'Return / Land' }
            ]}
          />
          <ParamInput
            label="Warn level"
            param="BAT_LOW_THR"
            unit="%"
            scale={100}
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamInput
            label="Critical level"
            param="BAT_CRIT_THR"
            unit="%"
            scale={100}
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamInput
            label="Emergency level"
            param="BAT_EMERGEN_THR"
            unit="%"
            scale={100}
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* RC Loss */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconRadio />
            </CardIcon>
            RC Loss Failsafe
          </div>
          <ParamSelect
            label="Failsafe action"
            param="NAV_RCL_ACT"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 1, label: 'Hold' },
              { value: 2, label: 'Return' },
              { value: 3, label: 'Land' },
              { value: 5, label: 'Terminate' },
              { value: 6, label: 'Disarm' }
            ]}
          />
          <ParamInput
            label="Timeout"
            param="COM_RC_LOSS_T"
            unit="s"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* Data Link Loss */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconLink />
            </CardIcon>
            Data Link Loss Failsafe
          </div>
          <ParamSelect
            label="Failsafe action"
            param="NAV_DLL_ACT"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Disabled' },
              { value: 1, label: 'Hold' },
              { value: 2, label: 'Return' },
              { value: 3, label: 'Land' },
              { value: 5, label: 'Terminate' },
              { value: 6, label: 'Disarm' }
            ]}
          />
          <ParamInput
            label="Timeout"
            param="COM_DL_LOSS_T"
            unit="s"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* Geofence */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconFence />
            </CardIcon>
            Geofence
          </div>
          <ParamSelect
            label="Breach action"
            param="GF_ACTION"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'None' },
              { value: 1, label: 'Warning' },
              { value: 2, label: 'Hold' },
              { value: 3, label: 'Return' },
              { value: 4, label: 'Terminate' },
              { value: 5, label: 'Land' }
            ]}
          />
          <ParamInput
            label="Max radius"
            param="GF_MAX_HOR_DIST"
            unit="m"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamInput
            label="Max altitude"
            param="GF_MAX_VER_DIST"
            unit="m"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* Return to Launch */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconHome />
            </CardIcon>
            Return to Launch
          </div>
          <ParamInput
            label="Climb to altitude"
            param="RTL_RETURN_ALT"
            unit="m"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>After return</span>
            <select
              className={styles.paramSelect}
              value={rtlMode}
              onChange={(e) => {
                const m = e.target.value
                if (m === 'land') onEdit('RTL_LAND_DELAY', 0)
                else if (m === 'loiter') onEdit('RTL_LAND_DELAY', -1)
                else onEdit('RTL_LAND_DELAY', 60)
              }}
            >
              <option value="land">Land immediately</option>
              <option value="loiter">Loiter, do not land</option>
              <option value="loiterLand">Loiter, then land</option>
            </select>
          </div>
          {rtlMode === 'loiterLand' && (
            <ParamInput
              label="Loiter time"
              param="RTL_LAND_DELAY"
              unit="s"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
          )}
          {rtlMode !== 'land' && (
            <ParamInput
              label="Loiter altitude"
              param="RTL_DESCEND_ALT"
              unit="m"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
          )}
        </div>

        {/* Land Mode */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconLand />
            </CardIcon>
            Land Mode
          </div>
          <ParamInput
            label="Descent rate"
            param="MPC_LAND_SPEED"
            unit="m/s"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamInput
            label="Disarm after"
            param="COM_DISARM_LAND"
            unit="s"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
          <button className={styles.btn} onClick={() => setEdits({})}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── ArduPilot Safety ───────────────────────── */

function ArduPilotSafetyPage(): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1

  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

  useEffect(() => {
    setEdits({})
  }, [loadState.parametersReady])

  const onEdit = useCallback((param: string, value: number) => {
    setEdits((prev) => ({ ...prev, [param]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.parametersSet(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Safety</div>
        <ParameterLoading />
      </div>
    )
  }

  const hasBatt1 =
    parameters.get('BATT_MONITOR') && (parameters.get('BATT_MONITOR')?.value ?? 0) > 0
  const hasBatt2 =
    parameters.get('BATT2_MONITOR') && (parameters.get('BATT2_MONITOR')?.value ?? 0) > 0

  // Fence type bitmask
  const fenceEnabled = (getParamVal(parameters, edits, 'FENCE_ENABLE') ?? 0) > 0

  // RTL altitude
  const rtlAlt = getParamVal(parameters, edits, 'RTL_ALT')
  const rtlUseCurrent = rtlAlt === 0

  return (
    <div className={styles.root}>
      <div className={styles.title}>Safety</div>
      <div className={styles.cardGrid}>
        {/* Battery 1 Failsafe */}
        {hasBatt1 && (
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <CardIcon>
                <IconBattery />
              </CardIcon>
              Battery 1 Failsafe
            </div>
            <ParamSelect
              label="Low action"
              param="BATT_FS_LOW_ACT"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
              options={[
                { value: 0, label: 'Disabled' },
                { value: 1, label: 'Land' },
                { value: 2, label: 'RTL' },
                { value: 3, label: 'SmartRTL or RTL' },
                { value: 4, label: 'SmartRTL or Land' },
                { value: 5, label: 'Terminate' }
              ]}
            />
            <ParamSelect
              label="Critical action"
              param="BATT_FS_CRT_ACT"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
              options={[
                { value: 0, label: 'Disabled' },
                { value: 1, label: 'Land' },
                { value: 2, label: 'RTL' },
                { value: 3, label: 'SmartRTL or RTL' },
                { value: 4, label: 'SmartRTL or Land' },
                { value: 5, label: 'Terminate' }
              ]}
            />
            <ParamInput
              label="Low voltage"
              param="BATT_LOW_VOLT"
              unit="V"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Critical voltage"
              param="BATT_CRT_VOLT"
              unit="V"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Low mAh"
              param="BATT_LOW_MAH"
              unit="mAh"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Critical mAh"
              param="BATT_CRT_MAH"
              unit="mAh"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
          </div>
        )}

        {/* Battery 2 Failsafe */}
        {hasBatt2 && (
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <CardIcon>
                <IconBattery />
              </CardIcon>
              Battery 2 Failsafe
            </div>
            <ParamSelect
              label="Low action"
              param="BATT2_FS_LOW_ACT"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
              options={[
                { value: 0, label: 'Disabled' },
                { value: 1, label: 'Land' },
                { value: 2, label: 'RTL' },
                { value: 3, label: 'SmartRTL or RTL' },
                { value: 4, label: 'SmartRTL or Land' },
                { value: 5, label: 'Terminate' }
              ]}
            />
            <ParamSelect
              label="Critical action"
              param="BATT2_FS_CRT_ACT"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
              options={[
                { value: 0, label: 'Disabled' },
                { value: 1, label: 'Land' },
                { value: 2, label: 'RTL' },
                { value: 3, label: 'SmartRTL or RTL' },
                { value: 4, label: 'SmartRTL or Land' },
                { value: 5, label: 'Terminate' }
              ]}
            />
            <ParamInput
              label="Low voltage"
              param="BATT2_LOW_VOLT"
              unit="V"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Critical voltage"
              param="BATT2_CRT_VOLT"
              unit="V"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Low mAh"
              param="BATT2_LOW_MAH"
              unit="mAh"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
            <ParamInput
              label="Critical mAh"
              param="BATT2_CRT_MAH"
              unit="mAh"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
          </div>
        )}

        {/* General Failsafe */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconWarning />
            </CardIcon>
            General Failsafe
          </div>
          <ParamSelect
            label="GCS failsafe"
            param="FS_GCS_ENABLE"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Disabled' },
              { value: 1, label: 'RTL' },
              { value: 2, label: 'Continue in Auto' }
            ]}
          />
          <ParamSelect
            label="Throttle failsafe"
            param="FS_THR_ENABLE"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Disabled' },
              { value: 1, label: 'Always RTL' },
              { value: 2, label: 'Continue in Auto' },
              { value: 3, label: 'Always Land' }
            ]}
          />
          <ParamInput
            label="Throttle PWM"
            param="FS_THR_VALUE"
            unit="PWM"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamSelect
            label="EKF failsafe"
            param="FS_EKF_ACTION"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Disabled' },
              { value: 1, label: 'Land' },
              { value: 2, label: 'AltHold' },
              { value: 3, label: 'Land (even in Stabilize)' }
            ]}
          />
          <ParamInput
            label="EKF threshold"
            param="FS_EKF_THRESH"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* Geofence */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconFence />
            </CardIcon>
            Geofence
          </div>
          <ParamSelect
            label="Enable"
            param="FENCE_ENABLE"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
            options={[
              { value: 0, label: 'Disabled' },
              { value: 1, label: 'Enabled' }
            ]}
          />
          {fenceEnabled && (
            <>
              <ParamSelect
                label="Breach action"
                param="FENCE_ACTION"
                parameters={parameters}
                edits={edits}
                onEdit={onEdit}
                options={[
                  { value: 0, label: 'Report only' },
                  { value: 1, label: 'RTL or Land' },
                  { value: 2, label: 'Always Land' },
                  { value: 3, label: 'SmartRTL or RTL' },
                  { value: 4, label: 'Brake or Land' }
                ]}
              />
              <ParamSelect
                label="Fence type"
                param="FENCE_TYPE"
                parameters={parameters}
                edits={edits}
                onEdit={onEdit}
                options={[
                  { value: 1, label: 'Altitude only' },
                  { value: 2, label: 'Circle only' },
                  { value: 3, label: 'Altitude + Circle' },
                  { value: 4, label: 'Polygon only' },
                  { value: 5, label: 'Altitude + Polygon' },
                  { value: 6, label: 'Circle + Polygon' },
                  { value: 7, label: 'All' }
                ]}
              />
              <ParamInput
                label="Max altitude"
                param="FENCE_ALT_MAX"
                unit="m"
                parameters={parameters}
                edits={edits}
                onEdit={onEdit}
              />
              <ParamInput
                label="Circle radius"
                param="FENCE_RADIUS"
                unit="m"
                parameters={parameters}
                edits={edits}
                onEdit={onEdit}
              />
              <ParamInput
                label="Fence margin"
                param="FENCE_MARGIN"
                unit="m"
                parameters={parameters}
                edits={edits}
                onEdit={onEdit}
              />
            </>
          )}
        </div>

        {/* Return to Launch */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconHome />
            </CardIcon>
            Return to Launch
          </div>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>Return altitude</span>
            <select
              className={styles.paramSelect}
              value={rtlUseCurrent ? 'current' : 'specified'}
              onChange={(e) => {
                if (e.target.value === 'current') onEdit('RTL_ALT', 0)
                else onEdit('RTL_ALT', 1500) // 15m in cm
              }}
            >
              <option value="current">Current altitude</option>
              <option value="specified">Specified altitude</option>
            </select>
          </div>
          {!rtlUseCurrent && (
            <ParamInput
              label="RTL altitude"
              param="RTL_ALT"
              unit="cm"
              parameters={parameters}
              edits={edits}
              onEdit={onEdit}
            />
          )}
          <ParamInput
            label="Loiter time"
            param="RTL_LOIT_TIME"
            unit="ms"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <ParamInput
            label="Final descent speed"
            param="LAND_SPEED"
            unit="cm/s"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
        </div>

        {/* Arming Checks */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            <CardIcon>
              <IconCheck />
            </CardIcon>
            Arming Checks
          </div>
          <ParamInput
            label="Arming check bitmask"
            param="ARMING_CHECK"
            parameters={parameters}
            edits={edits}
            onEdit={onEdit}
          />
          <div className={styles.paramHint}>1 = all checks enabled, 0 = all disabled</div>
        </div>
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
          <button className={styles.btn} onClick={() => setEdits({})}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Main entry — detect autopilot type ────── */

export function SafetyPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicles = useVehicleStore((s) => s.vehicles)
  const autopilot = activeVehicleId ? vehicles[activeVehicleId]?.core?.autopilot : undefined
  const isPX4 = autopilot === MAV_AUTOPILOT_PX4

  return isPX4 ? <PX4SafetyPage /> : <ArduPilotSafetyPage />
}
