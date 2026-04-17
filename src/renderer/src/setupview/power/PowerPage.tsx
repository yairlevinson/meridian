import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import styles from './PowerPage.module.css'

const MAV_AUTOPILOT_PX4 = 12

/* ── PX4 Source enum ─────────────────────────── */

const PX4_SOURCES: Array<{ value: number; label: string }> = [
  { value: -1, label: 'Disabled' },
  { value: 0, label: 'Power Module' },
  { value: 1, label: 'External' },
  { value: 2, label: 'ESCs' }
]

/* ── ArduPilot Monitor enum (common subset) ──── */

const ARDU_MONITORS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Disabled' },
  { value: 3, label: 'Analog Voltage and Current' },
  { value: 4, label: 'Analog Voltage Only' },
  { value: 5, label: 'Solo' },
  { value: 6, label: 'Bebop' },
  { value: 7, label: 'SMBus-Generic' },
  { value: 8, label: 'DroneCAN' },
  { value: 9, label: 'ESC' },
  { value: 16, label: 'Analog V+I Sum Only' }
]

/* ── ArduPilot sensor presets ────────────────── */

const ARDU_PRESETS: Array<{
  name: string
  voltPin: number
  currPin: number
  voltMult: number
  ampPerVolt: number
  ampOffset?: number
}> = [
  { name: 'Power Module 90A', voltPin: 2, currPin: 3, voltMult: 10.1, ampPerVolt: 17.0 },
  { name: 'Power Module HV', voltPin: 2, currPin: 3, voltMult: 12.02, ampPerVolt: 39.877 },
  { name: '3DR Iris', voltPin: 2, currPin: 3, voltMult: 12.02, ampPerVolt: 17.0 },
  {
    name: 'Blue Robotics Power Sense',
    voltPin: 2,
    currPin: 3,
    voltMult: 11.0,
    ampPerVolt: 37.8788,
    ampOffset: 0.33
  }
]

/* ── Battery SVG (cell visualization) ────────── */

function BatteryCellsSvg({
  cells,
  className
}: {
  cells: number
  className?: string
}): React.JSX.Element {
  const displayCells = Math.max(1, Math.min(cells, 12))
  const cellH = 12
  const gap = 2
  const totalH = displayCells * (cellH + gap) - gap
  const w = 40
  const h = totalH + 16
  const termW = 14
  const termH = 4

  return (
    <svg
      width={w}
      height={h + termH + 2}
      viewBox={`0 0 ${w} ${h + termH + 2}`}
      className={className}
    >
      {/* Terminal */}
      <rect
        x={(w - termW) / 2}
        y={0}
        width={termW}
        height={termH}
        rx={1}
        fill="rgba(255,255,255,0.3)"
      />
      {/* Body */}
      <rect
        x={2}
        y={termH + 2}
        width={w - 4}
        height={h}
        rx={3}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={1.5}
      />
      {/* Cells */}
      {Array.from({ length: displayCells }, (_, i) => (
        <rect
          key={i}
          x={6}
          y={termH + 2 + 6 + i * (cellH + gap)}
          width={w - 12}
          height={cellH}
          rx={1.5}
          fill="rgba(0, 200, 83, 0.5)"
        />
      ))}
    </svg>
  )
}

/* ── Calculate dialog ────────────────────────── */

function CalcDialog({
  title,
  measuredLabel,
  measuredUnit,
  vehicleValue,
  vehicleUnit,
  currentFactor,
  onApply,
  onClose
}: {
  title: string
  measuredLabel: string
  measuredUnit: string
  vehicleValue: number
  vehicleUnit: string
  currentFactor: number
  onApply: (newFactor: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [measured, setMeasured] = useState('')

  const newFactor = useMemo(() => {
    const m = parseFloat(measured)
    if (!m || !vehicleValue) return null
    return (m * currentFactor) / vehicleValue
  }, [measured, vehicleValue, currentFactor])

  return (
    <div className={styles.calcOverlay} onClick={onClose}>
      <div className={styles.calcDialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.calcTitle}>{title}</div>
        <div className={styles.calcBody}>
          <div className={styles.calcRow}>
            <span>{measuredLabel}:</span>
            <div className={styles.calcInputWrap}>
              <input
                className={styles.calcInput}
                type="number"
                step="any"
                placeholder="0.0"
                value={measured}
                onChange={(e) => setMeasured(e.target.value)}
                autoFocus
              />
              <span className={styles.calcUnit}>{measuredUnit}</span>
            </div>
          </div>
          <div className={styles.calcRow}>
            <span>Vehicle reading:</span>
            <span className={styles.calcValue}>
              {vehicleValue.toFixed(2)} {vehicleUnit}
            </span>
          </div>
          <div className={styles.calcRow}>
            <span>Current factor:</span>
            <span className={styles.calcValue}>{currentFactor.toFixed(6)}</span>
          </div>
          {newFactor !== null && (
            <div className={styles.calcRow}>
              <span>New factor:</span>
              <span className={styles.calcValueNew}>{newFactor.toFixed(6)}</span>
            </div>
          )}
        </div>
        <div className={styles.calcActions}>
          <button
            className={styles.calcApply}
            disabled={newFactor === null || newFactor <= 0}
            onClick={() => newFactor && newFactor > 0 && onApply(newFactor)}
          >
            Apply
          </button>
          <button className={styles.calcCancel} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Param input row ─────────────────────────── */

function ParamInput({
  label,
  unit,
  value,
  disabled,
  modified,
  onChange
}: {
  label: string
  unit?: string
  value: number | undefined
  disabled?: boolean
  modified?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className={styles.paramRow}>
      <span className={`${styles.paramLabel} ${modified ? styles.paramModified : ''}`}>
        {label}
      </span>
      <div className={styles.paramInputWrap}>
        <input
          className={styles.paramInput}
          type="number"
          step="any"
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (!isNaN(n)) onChange(n)
          }}
        />
        {unit && <span className={styles.paramUnit}>{unit}</span>}
      </div>
    </div>
  )
}

/* ── PX4 Battery Card ────────────────────────── */

function PX4BatteryCard({
  batteryIndex,
  vehicleId
}: {
  batteryIndex: number
  vehicleId: number
}): React.JSX.Element | null {
  const parameters = useParameterStore((s) => s.parameters)
  const battery = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    if (!vid) return undefined
    return s.vehicles[vid]?.battery?.batteries?.find((b) => b.id === batteryIndex - 1)
  })

  const prefix = `BAT${batteryIndex}_`
  const paramGet = (name: string) => parameters.get(`${prefix}${name}`)

  const [edits, setEdits] = useState<Record<string, number>>({})
  const [calcMode, setCalcMode] = useState<'voltage' | 'current' | null>(null)

  const sourceParam = paramGet('SOURCE')
  if (!sourceParam) return null

  const val = (name: string) => edits[`${prefix}${name}`] ?? paramGet(name)?.value
  const edit = (name: string, v: number) => setEdits((p) => ({ ...p, [`${prefix}${name}`]: v }))
  const hasChanges = Object.keys(edits).length > 0
  const source = val('SOURCE') ?? -1
  const isEnabled = source !== -1
  const cells = val('N_CELLS') ?? 0
  const vEmpty = val('V_EMPTY') ?? 3.6
  const vCharged = val('V_CHARGED') ?? 4.2
  const vDiv = val('V_DIV') ?? 1
  const aPV = val('A_PER_V') ?? 1

  useEffect(() => {
    setEdits({})
  }, [parameters])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.parametersSet(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  return (
    <div className={styles.batteryCard}>
      <div className={styles.batteryHeader}>
        <span className={styles.batteryTitle}>Battery {batteryIndex}</span>
        {battery && battery.voltage > 0 && (
          <div className={styles.liveTelemetry}>
            <span className={styles.liveValue}>{battery.voltage.toFixed(1)}V</span>
            <span className={styles.liveValue}>{battery.current.toFixed(1)}A</span>
            {battery.remaining >= 0 && (
              <span className={styles.liveValue}>{battery.remaining}%</span>
            )}
          </div>
        )}
      </div>

      <div className={styles.batteryBody}>
        {/* Left: params */}
        <div className={styles.batteryParams}>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>Source</span>
            <select
              className={styles.selectInput}
              value={source}
              onChange={(e) => edit('SOURCE', Number(e.target.value))}
            >
              {PX4_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {isEnabled && (
            <>
              {paramGet('N_CELLS') && (
                <ParamInput
                  label="Cells (series)"
                  value={cells}
                  modified={'BAT' + batteryIndex + '_N_CELLS' in edits}
                  onChange={(v) => edit('N_CELLS', v)}
                />
              )}
              {paramGet('V_EMPTY') && (
                <ParamInput
                  label="Empty voltage"
                  unit="V/cell"
                  value={vEmpty}
                  modified={`${prefix}V_EMPTY` in edits}
                  onChange={(v) => edit('V_EMPTY', v)}
                />
              )}
              {paramGet('V_CHARGED') && (
                <ParamInput
                  label="Full voltage"
                  unit="V/cell"
                  value={vCharged}
                  modified={`${prefix}V_CHARGED` in edits}
                  onChange={(v) => edit('V_CHARGED', v)}
                />
              )}
              {paramGet('CAPACITY') && (
                <ParamInput
                  label="Capacity"
                  unit="mAh"
                  value={val('CAPACITY') === -1 ? undefined : val('CAPACITY')}
                  modified={`${prefix}CAPACITY` in edits}
                  onChange={(v) => edit('CAPACITY', v)}
                />
              )}
              {paramGet('V_DIV') && (
                <div className={styles.paramRow}>
                  <span
                    className={`${styles.paramLabel} ${`${prefix}V_DIV` in edits ? styles.paramModified : ''}`}
                  >
                    Voltage divider
                  </span>
                  <div className={styles.paramInputWrap}>
                    <input
                      className={styles.paramInput}
                      type="number"
                      step="any"
                      value={vDiv}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value)
                        if (!isNaN(n)) edit('V_DIV', n)
                      }}
                    />
                    <button className={styles.calcBtn} onClick={() => setCalcMode('voltage')}>
                      Calc
                    </button>
                  </div>
                </div>
              )}
              {paramGet('A_PER_V') && (
                <div className={styles.paramRow}>
                  <span
                    className={`${styles.paramLabel} ${`${prefix}A_PER_V` in edits ? styles.paramModified : ''}`}
                  >
                    Amps per volt
                  </span>
                  <div className={styles.paramInputWrap}>
                    <input
                      className={styles.paramInput}
                      type="number"
                      step="any"
                      value={aPV}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value)
                        if (!isNaN(n)) edit('A_PER_V', n)
                      }}
                    />
                    <button className={styles.calcBtn} onClick={() => setCalcMode('current')}>
                      Calc
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: battery visual + computed values */}
        {isEnabled && cells > 0 && (
          <div className={styles.batteryVisual}>
            <BatteryCellsSvg cells={cells} />
            <div className={styles.batteryStats}>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Max</span>
                <span className={styles.statValue}>{(cells * vCharged).toFixed(1)} V</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Min</span>
                <span className={styles.statValue}>{(cells * vEmpty).toFixed(1)} V</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>{cells}S</span>
                <span className={styles.statDim}>{(cells * 3.7).toFixed(1)} V nom</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {hasChanges && (
        <div className={styles.cardToolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
          <button className={styles.cancelBtn} onClick={() => setEdits({})}>
            Discard
          </button>
        </div>
      )}

      {calcMode === 'voltage' && (
        <CalcDialog
          title="Calculate Voltage Divider"
          measuredLabel="Measured voltage"
          measuredUnit="V"
          vehicleValue={battery?.voltage ?? 0}
          vehicleUnit="V"
          currentFactor={vDiv}
          onApply={(v) => {
            edit('V_DIV', v)
            setCalcMode(null)
          }}
          onClose={() => setCalcMode(null)}
        />
      )}
      {calcMode === 'current' && (
        <CalcDialog
          title="Calculate Amps Per Volt"
          measuredLabel="Measured current"
          measuredUnit="A"
          vehicleValue={battery?.current ?? 0}
          vehicleUnit="A"
          currentFactor={aPV}
          onApply={(v) => {
            edit('A_PER_V', v)
            setCalcMode(null)
          }}
          onClose={() => setCalcMode(null)}
        />
      )}
    </div>
  )
}

/* ── ArduPilot Battery Card ──────────────────── */

function ArduBatteryCard({
  prefix,
  label,
  batteryIdx,
  vehicleId
}: {
  prefix: string
  label: string
  batteryIdx: number
  vehicleId: number
}): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const battery = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    if (!vid) return undefined
    return s.vehicles[vid]?.battery?.batteries?.find((b) => b.id === batteryIdx)
  })

  const paramGet = (suffix: string) => parameters.get(`${prefix}${suffix}`)
  const [edits, setEdits] = useState<Record<string, number>>({})
  const hasChanges = Object.keys(edits).length > 0

  const val = (suffix: string) => edits[`${prefix}${suffix}`] ?? paramGet(suffix)?.value
  const edit = (suffix: string, v: number) => setEdits((p) => ({ ...p, [`${prefix}${suffix}`]: v }))

  const monitor = val('MONITOR') ?? 0
  const isEnabled = monitor !== 0

  useEffect(() => {
    setEdits({})
  }, [parameters])

  const handlePreset = useCallback(
    (idx: number) => {
      const p = ARDU_PRESETS[idx]
      if (!p) return
      setEdits((prev) => ({
        ...prev,
        [`${prefix}VOLT_PIN`]: p.voltPin,
        [`${prefix}CURR_PIN`]: p.currPin,
        [`${prefix}VOLT_MULT`]: p.voltMult,
        [`${prefix}AMP_PERVLT`]: p.ampPerVolt,
        ...(p.ampOffset !== undefined ? { [`${prefix}AMP_OFFSET`]: p.ampOffset } : {})
      }))
    },
    [prefix]
  )

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    for (const [name, value] of Object.entries(edits)) {
      await bridge.parametersSet(vehicleId, name, value)
    }
    setEdits({})
  }, [vehicleId, edits])

  return (
    <div className={styles.batteryCard}>
      <div className={styles.batteryHeader}>
        <span className={styles.batteryTitle}>{label}</span>
        {battery && battery.voltage > 0 && (
          <div className={styles.liveTelemetry}>
            <span className={styles.liveValue}>{battery.voltage.toFixed(1)}V</span>
            <span className={styles.liveValue}>{battery.current.toFixed(1)}A</span>
            {battery.remaining >= 0 && (
              <span className={styles.liveValue}>{battery.remaining}%</span>
            )}
          </div>
        )}
      </div>

      <div className={styles.batteryParams}>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>Monitor</span>
          <select
            className={styles.selectInput}
            value={monitor}
            onChange={(e) => edit('MONITOR', Number(e.target.value))}
          >
            {ARDU_MONITORS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {isEnabled && (
          <>
            {paramGet('CAPACITY') && (
              <ParamInput
                label="Capacity"
                unit="mAh"
                value={val('CAPACITY') === -1 ? undefined : val('CAPACITY')}
                modified={`${prefix}CAPACITY` in edits}
                onChange={(v) => edit('CAPACITY', v)}
              />
            )}
            {paramGet('ARM_VOLT') && (
              <ParamInput
                label="Min arming voltage"
                unit="V"
                value={val('ARM_VOLT')}
                modified={`${prefix}ARM_VOLT` in edits}
                onChange={(v) => edit('ARM_VOLT', v)}
              />
            )}
            {paramGet('ARM_MAH') && (
              <ParamInput
                label="Min arming mAh"
                unit="mAh"
                value={val('ARM_MAH')}
                modified={`${prefix}ARM_MAH` in edits}
                onChange={(v) => edit('ARM_MAH', v)}
              />
            )}

            {/* Sensor config */}
            <div className={styles.sensorSection}>
              <div className={styles.sensorHeader}>
                <span className={styles.sensorTitle}>Sensor</span>
                <select
                  className={styles.presetSelect}
                  defaultValue=""
                  onChange={(e) => handlePreset(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Preset...
                  </option>
                  {ARDU_PRESETS.map((p, i) => (
                    <option key={p.name} value={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {paramGet('VOLT_PIN') && (
                <ParamInput
                  label="Voltage pin"
                  value={val('VOLT_PIN')}
                  modified={`${prefix}VOLT_PIN` in edits}
                  onChange={(v) => edit('VOLT_PIN', v)}
                />
              )}
              {paramGet('CURR_PIN') && (
                <ParamInput
                  label="Current pin"
                  value={val('CURR_PIN')}
                  modified={`${prefix}CURR_PIN` in edits}
                  onChange={(v) => edit('CURR_PIN', v)}
                />
              )}
              {paramGet('VOLT_MULT') && (
                <ParamInput
                  label="Voltage multiplier"
                  value={val('VOLT_MULT')}
                  modified={`${prefix}VOLT_MULT` in edits}
                  onChange={(v) => edit('VOLT_MULT', v)}
                />
              )}
              {paramGet('AMP_PERVLT') && (
                <ParamInput
                  label="Amps per volt"
                  value={val('AMP_PERVLT')}
                  modified={`${prefix}AMP_PERVLT` in edits}
                  onChange={(v) => edit('AMP_PERVLT', v)}
                />
              )}
              {paramGet('AMP_OFFSET') && (
                <ParamInput
                  label="Amps offset"
                  unit="A"
                  value={val('AMP_OFFSET')}
                  modified={`${prefix}AMP_OFFSET` in edits}
                  onChange={(v) => edit('AMP_OFFSET', v)}
                />
              )}
            </div>
          </>
        )}
      </div>

      {hasChanges && (
        <div className={styles.cardToolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
          <button className={styles.cancelBtn} onClick={() => setEdits({})}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── PX4 Power Page ──────────────────────────── */

function PX4PowerPage({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const batteryCount = useMemo(() => {
    let count = 0
    for (let i = 1; i <= 4; i++) {
      if (parameters.get(`BAT${i}_SOURCE`) !== undefined) count = i
      else break
    }
    return Math.max(count, 1)
  }, [parameters])

  return (
    <div className={styles.root}>
      <div className={styles.title}>Power</div>
      <div className={styles.cardGrid}>
        {Array.from({ length: batteryCount }, (_, i) => (
          <PX4BatteryCard key={i} batteryIndex={i + 1} vehicleId={vehicleId} />
        ))}
      </div>
    </div>
  )
}

/* ── ArduPilot Power Page ────────────────────── */

function ArduPilotPowerPage({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const batteries = useMemo(() => {
    const result: Array<{ prefix: string; label: string; idx: number }> = []
    if (parameters.get('BATT_MONITOR') !== undefined) {
      result.push({ prefix: 'BATT_', label: 'Battery 1', idx: 0 })
    }
    for (let i = 2; i <= 9; i++) {
      if (parameters.get(`BATT${i}_MONITOR`) !== undefined) {
        result.push({ prefix: `BATT${i}_`, label: `Battery ${i}`, idx: i - 1 })
      }
    }
    return result
  }, [parameters])

  return (
    <div className={styles.root}>
      <div className={styles.title}>Power</div>
      <div className={styles.cardGrid}>
        {batteries.map((b) => (
          <ArduBatteryCard
            key={b.prefix}
            prefix={b.prefix}
            label={b.label}
            batteryIdx={b.idx}
            vehicleId={vehicleId}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Main entry ──────────────────────────────── */

export function PowerPage(): React.JSX.Element {
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1
  const vehicles = useVehicleStore((s) => s.vehicles)
  const autopilot = vehicleId ? vehicles[vehicleId]?.core?.autopilot : undefined
  const isPX4 = autopilot === MAV_AUTOPILOT_PX4

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Power</div>
        <ParameterLoading />
      </div>
    )
  }

  return isPX4 ? (
    <PX4PowerPage vehicleId={vehicleId} />
  ) : (
    <ArduPilotPowerPage vehicleId={vehicleId} />
  )
}
