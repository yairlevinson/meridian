import { useState, useEffect, useCallback, useMemo } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useParameterStore } from '../../store/parameterStore'
import {
  VehicleType,
  getModeNamesForVehicleType,
  mavTypeToVehicleType
} from '../../../../shared-types/ipc/SetupTypes'
import styles from './FlightModesPage.module.css'

const MAV_AUTOPILOT_PX4 = 12

/* ── PX4 mode definitions ──────────────────── */

const PX4_MODES: Array<{ value: number; label: string }> = [
  { value: -1, label: 'Unassigned' },
  { value: 0, label: 'Manual' },
  { value: 1, label: 'Altitude' },
  { value: 2, label: 'Position' },
  { value: 3, label: 'Mission' },
  { value: 4, label: 'Hold' },
  { value: 5, label: 'Return' },
  { value: 6, label: 'Acro' },
  { value: 7, label: 'Offboard' },
  { value: 8, label: 'Stabilized' },
  { value: 9, label: 'Position Slow' },
  { value: 10, label: 'Takeoff' },
  { value: 11, label: 'Land' },
  { value: 12, label: 'Follow Me' },
  { value: 13, label: 'Precision Land' },
  { value: 16, label: 'Altitude Cruise' }
]

/**
 * PX4 active slot detection — matches QGC PX4SimpleFlightModesController.
 * Normalises the PWM value using per-channel calibration, then divides
 * the -1..+1 range into 6 equal slots.
 */
function px4ActiveSlot(
  pwm: number,
  rcMin: number,
  rcMax: number,
  rcTrim: number,
  rcRev: number
): number {
  if (pwm <= 0) return 0
  let cal: number
  if (pwm > rcTrim) {
    cal = (pwm - rcTrim) / (rcMax - rcTrim)
  } else if (pwm < rcTrim) {
    cal = (pwm - rcTrim) / (rcTrim - rcMin)
  } else {
    cal = 0
  }
  cal *= rcRev

  const numSlots = 6
  const slotWidthHalf = 2.0 / numSlots / 2.0
  const slotMin = -1.0 - 0.05
  const slotMax = 1.0 + 0.05

  let slot = Math.floor(
    ((cal - slotMin) * numSlots + slotWidthHalf) / (slotMax - slotMin) + 1.0 / numSlots
  )
  if (slot >= numSlots) slot = numSlots - 1
  return slot + 1 // 1-based
}

/* ── ArduPilot PWM ranges ──────────────────── */

const ARDU_PWM_RANGES = [
  { min: 0, max: 1230 },
  { min: 1231, max: 1360 },
  { min: 1361, max: 1490 },
  { min: 1491, max: 1620 },
  { min: 1621, max: 1749 },
  { min: 1750, max: 2200 }
]

function arduActiveSlotForPwm(pwm: number): number {
  for (let i = 0; i < ARDU_PWM_RANGES.length; i++) {
    if (pwm <= ARDU_PWM_RANGES[i]!.max) return i + 1
  }
  return 6
}

/* ── PX4 switch settings ──────────────────── */

interface SwitchDef {
  param: string
  label: string
  condition?: 'vtol' | 'fixedWing'
}

const PX4_SWITCHES: SwitchDef[] = [
  { param: 'RC_MAP_ARM_SW', label: 'Arm switch channel' },
  { param: 'RC_MAP_GEAR_SW', label: 'Landing gear switch channel' },
  { param: 'RC_MAP_KILL_SW', label: 'Emergency Kill switch channel' },
  { param: 'RC_MAP_LOITER_SW', label: 'Loiter switch channel' },
  { param: 'RC_MAP_OFFB_SW', label: 'Offboard switch channel' },
  { param: 'RC_MAP_RETURN_SW', label: 'Return switch channel' },
  { param: 'RC_MAP_TRANS_SW', label: 'Transition switch channel', condition: 'vtol' },
  { param: 'RC_MAP_FLAPS', label: 'Flaps channel', condition: 'fixedWing' }
]

/** Channel selector dropdown reused by switch settings */
function ChannelSelect({
  value,
  onChange,
  maxChannels = 18
}: {
  value: number
  onChange: (ch: number) => void
  maxChannels?: number
}): React.JSX.Element {
  return (
    <select
      className={styles.channelSelect}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={0}>Unassigned</option>
      {Array.from({ length: maxChannels }, (_, i) => (
        <option key={i + 1} value={i + 1}>
          Channel {i + 1}
        </option>
      ))}
    </select>
  )
}

/* ── Channel Monitor ─────────────────────── */

function ChannelMonitor({
  rc
}: {
  rc: { channels: number[]; channelCount: number } | undefined
}): React.JSX.Element {
  const count = rc?.channelCount ?? 0
  const channels = rc?.channels ?? []
  return (
    <div className={styles.channelMonitor}>
      <div className={styles.sectionTitle}>Channel Monitor</div>
      <div className={styles.channelBars}>
        {Array.from({ length: count }, (_, i) => {
          const pwm = channels[i] ?? 1500
          const pct = Math.max(0, Math.min(100, ((pwm - 1000) / 1000) * 100))
          return (
            <div key={i} className={styles.channelBarRow}>
              <span className={styles.channelBarLabel}>{i + 1}</span>
              <div className={styles.channelBarTrack}>
                <div className={styles.channelBarFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.channelBarValue}>{pwm}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── PX4 Flight Modes ─────────────────────── */

function PX4FlightModesPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicleId = activeVehicleId ?? 1
  const parameters = useParameterStore((s) => s.parameters)
  const vehicles = useVehicleStore((s) => s.vehicles)
  const rc = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid]?.rc : undefined
  })

  const vehicleType = activeVehicleId ? (vehicles[activeVehicleId]?.core?.vehicleType ?? 0) : 0
  // MAV_TYPE: 1=fixed-wing, 19-25=VTOL
  const isVtol = vehicleType >= 19 && vehicleType <= 25
  const isFixedWing = vehicleType === 1 || isVtol

  // RC_MAP_FLTMODE: 1-based channel, 0 = unassigned
  const savedChannel = parameters.get('RC_MAP_FLTMODE')?.value ?? 0
  const savedModes = useMemo(() => {
    const m: number[] = []
    for (let i = 1; i <= 6; i++) {
      m.push(parameters.get(`COM_FLTMODE${i}`)?.value ?? -1)
    }
    return m
  }, [parameters])

  // Switch settings — read saved values
  const visibleSwitches = useMemo(
    () =>
      PX4_SWITCHES.filter((sw) => {
        if (sw.condition === 'vtol') return isVtol
        if (sw.condition === 'fixedWing') return isFixedWing
        return true
      }),
    [isVtol, isFixedWing]
  )

  const savedSwitchValues = useMemo(() => {
    const m = new Map<string, number>()
    for (const sw of visibleSwitches) {
      m.set(sw.param, parameters.get(sw.param)?.value ?? 0)
    }
    return m
  }, [parameters, visibleSwitches])

  const [modeChannel, setModeChannel] = useState(savedChannel)
  const [modes, setModes] = useState<number[]>(savedModes)
  const [switchValues, setSwitchValues] = useState<Map<string, number>>(savedSwitchValues)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setModeChannel(savedChannel)
    setModes(savedModes)
    setSwitchValues(savedSwitchValues)
    setHasChanges(false)
  }, [savedChannel, savedModes, savedSwitchValues])

  // Active slot detection using RC calibration data
  const activeSlot = useMemo(() => {
    if (modeChannel === 0) return 0
    const pwm = rc?.channels[modeChannel - 1] ?? 0
    if (pwm <= 0) return 0
    const ch = modeChannel
    const rcMin = parameters.get(`RC${ch}_MIN`)?.value ?? 1000
    const rcMax = parameters.get(`RC${ch}_MAX`)?.value ?? 2000
    const rcTrim = parameters.get(`RC${ch}_TRIM`)?.value ?? 1500
    const rcRev = parameters.get(`RC${ch}_REV`)?.value ?? 1
    return px4ActiveSlot(pwm, rcMin, rcMax, rcTrim, rcRev)
  }, [modeChannel, rc, parameters])

  const modeChannelPwm = modeChannel > 0 ? (rc?.channels[modeChannel - 1] ?? 0) : 0

  const handleModeChange = useCallback((slot: number, value: number) => {
    setModes((prev) => {
      const next = [...prev]
      next[slot - 1] = value
      return next
    })
    setHasChanges(true)
  }, [])

  const handleChannelChange = useCallback((ch: number) => {
    setModeChannel(ch)
    setHasChanges(true)
  }, [])

  const handleSwitchChange = useCallback((param: string, ch: number) => {
    setSwitchValues((prev) => {
      const next = new Map(prev)
      next.set(param, ch)
      return next
    })
    setHasChanges(true)
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    await bridge.setParameter(vehicleId, 'RC_MAP_FLTMODE', modeChannel)
    for (let i = 0; i < 6; i++) {
      await bridge.setParameter(vehicleId, `COM_FLTMODE${i + 1}`, modes[i]!)
    }
    for (const [param, value] of switchValues) {
      if (value !== (savedSwitchValues.get(param) ?? 0)) {
        await bridge.setParameter(vehicleId, param, value)
      }
    }
    setHasChanges(false)
  }, [vehicleId, modeChannel, modes, switchValues, savedSwitchValues])

  const handleDiscard = useCallback(() => {
    setModeChannel(savedChannel)
    setModes(savedModes)
    setSwitchValues(savedSwitchValues)
    setHasChanges(false)
  }, [savedChannel, savedModes, savedSwitchValues])

  return (
    <div className={styles.root}>
      <div className={styles.title}>Flight Modes</div>

      <div className={styles.px4Layout}>
        {/* Left column: Flight mode settings */}
        <div className={styles.px4Column}>
          <div className={styles.sectionTitle}>Flight Mode Settings</div>

          <div className={styles.channelSelector}>
            <span>Mode channel:</span>
            <ChannelSelect value={modeChannel} onChange={handleChannelChange} />
            <span className={styles.paramHint}>RC_MAP_FLTMODE</span>
          </div>

          <div className={styles.modeGrid}>
            {modes.map((modeValue, i) => {
              const slot = i + 1
              const isActive = activeSlot === slot
              return (
                <div
                  key={slot}
                  className={`${styles.modeRow} ${isActive ? styles.modeRowActive : ''}`}
                >
                  <span className={styles.slotBadge}>{slot}</span>
                  <select
                    className={styles.modeSelect}
                    value={modeValue}
                    onChange={(e) => handleModeChange(slot, Number(e.target.value))}
                  >
                    {PX4_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>

          {modeChannelPwm > 0 && (
            <div className={styles.activePwm}>
              CH{modeChannel} PWM: {modeChannelPwm} → Slot {activeSlot}
            </div>
          )}
        </div>

        {/* Right column: Switch settings + Channel monitor */}
        <div className={styles.px4Column}>
          <div className={styles.sectionTitle}>Switch Settings</div>
          <div className={styles.switchGrid}>
            {visibleSwitches.map((sw) => {
              const chVal = switchValues.get(sw.param) ?? 0
              return (
                <div
                  key={sw.param}
                  className={`${styles.switchRow} ${chVal > 0 ? styles.switchRowAssigned : ''}`}
                >
                  <span
                    className={`${styles.switchDot} ${chVal > 0 ? styles.switchDotActive : ''}`}
                  />
                  <span className={styles.switchLabel}>{sw.label}</span>
                  <ChannelSelect
                    value={chVal}
                    onChange={(ch) => handleSwitchChange(sw.param, ch)}
                  />
                </div>
              )
            })}
          </div>

          <ChannelMonitor rc={rc} />
        </div>
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
          <button className={styles.btn} onClick={handleDiscard}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── ArduPilot Flight Modes ────────────────── */

function ArduPilotFlightModesPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicleId = activeVehicleId ?? 1
  const parameters = useParameterStore((s) => s.parameters)
  const vehicles = useVehicleStore((s) => s.vehicles)
  const rc = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid]?.rc : undefined
  })

  // Detect vehicle type from MAV_TYPE, allow manual override
  const detectedType = activeVehicleId
    ? mavTypeToVehicleType(vehicles[activeVehicleId]?.core?.vehicleType ?? 0)
    : VehicleType.Copter
  const [vehicleTypeOverride, setVehicleTypeOverride] = useState<VehicleType | null>(null)
  const vehicleType = vehicleTypeOverride ?? detectedType

  const modeNames = useMemo(() => getModeNamesForVehicleType(vehicleType), [vehicleType])
  const MODE_OPTIONS = useMemo(
    () =>
      Object.entries(modeNames)
        .map(([num, name]) => ({ value: Number(num), label: `${num} - ${name}` }))
        .sort((a, b) => a.value - b.value),
    [modeNames]
  )

  // Rover uses MODE_CH / MODE1-6, others use FLTMODE_CH / FLTMODE1-6
  const isRover = vehicleType === VehicleType.Rover
  const chParam = isRover ? 'MODE_CH' : 'FLTMODE_CH'
  const modeParamPrefix = isRover ? 'MODE' : 'FLTMODE'

  const savedModeChannel = parameters.get(chParam)?.value ?? 5
  const savedModes = useMemo(() => {
    const m: number[] = []
    for (let i = 1; i <= 6; i++) {
      m.push(parameters.get(`${modeParamPrefix}${i}`)?.value ?? 0)
    }
    return m
  }, [parameters, modeParamPrefix])

  const savedSimpleBitmask = parameters.get('SIMPLE')?.value ?? 0
  const savedSuperSimpleBitmask = parameters.get('SUPER_SIMPLE')?.value ?? 0
  const showSimple = vehicleType === VehicleType.Copter

  const [modeChannel, setModeChannel] = useState(savedModeChannel)
  const [modes, setModes] = useState<number[]>(savedModes)
  const [simpleBitmask, setSimpleBitmask] = useState(savedSimpleBitmask)
  const [superSimpleBitmask, setSuperSimpleBitmask] = useState(savedSuperSimpleBitmask)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setModeChannel(savedModeChannel)
    setModes(savedModes)
    setSimpleBitmask(savedSimpleBitmask)
    setSuperSimpleBitmask(savedSuperSimpleBitmask)
    setHasChanges(false)
  }, [savedModeChannel, savedModes, savedSimpleBitmask, savedSuperSimpleBitmask])

  const modeChannelPwm = rc?.channels[modeChannel - 1] ?? 0
  const activeSlot = modeChannelPwm > 0 ? arduActiveSlotForPwm(modeChannelPwm) : 0

  const handleModeChange = useCallback((slot: number, modeNumber: number) => {
    setModes((prev) => {
      const next = [...prev]
      next[slot - 1] = modeNumber
      return next
    })
    setHasChanges(true)
  }, [])

  const handleChannelChange = useCallback((ch: number) => {
    setModeChannel(ch)
    setHasChanges(true)
  }, [])

  const handleSimpleToggle = useCallback((slot: number, checked: boolean) => {
    setSimpleBitmask((prev) => (checked ? prev | (1 << (slot - 1)) : prev & ~(1 << (slot - 1))))
    setHasChanges(true)
  }, [])

  const handleSuperSimpleToggle = useCallback((slot: number, checked: boolean) => {
    setSuperSimpleBitmask((prev) =>
      checked ? prev | (1 << (slot - 1)) : prev & ~(1 << (slot - 1))
    )
    setHasChanges(true)
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    await bridge.setParameter(vehicleId, chParam, modeChannel)
    for (let i = 0; i < 6; i++) {
      await bridge.setParameter(vehicleId, `${modeParamPrefix}${i + 1}`, modes[i]!)
    }
    if (showSimple) {
      await bridge.setParameter(vehicleId, 'SIMPLE', simpleBitmask)
      await bridge.setParameter(vehicleId, 'SUPER_SIMPLE', superSimpleBitmask)
    }
    setHasChanges(false)
  }, [
    vehicleId,
    chParam,
    modeParamPrefix,
    modeChannel,
    modes,
    showSimple,
    simpleBitmask,
    superSimpleBitmask
  ])

  const handleDiscard = useCallback(() => {
    setModeChannel(savedModeChannel)
    setModes(savedModes)
    setSimpleBitmask(savedSimpleBitmask)
    setSuperSimpleBitmask(savedSuperSimpleBitmask)
    setHasChanges(false)
  }, [savedModeChannel, savedModes, savedSimpleBitmask, savedSuperSimpleBitmask])

  return (
    <div className={styles.root}>
      <div className={styles.title}>Flight Modes</div>

      <div className={styles.channelSelector}>
        <span>Vehicle type:</span>
        <select
          className={styles.channelSelect}
          value={vehicleType}
          onChange={(e) => setVehicleTypeOverride(e.target.value as VehicleType)}
        >
          <option value={VehicleType.Copter}>Copter</option>
          <option value={VehicleType.Plane}>Plane</option>
          <option value={VehicleType.Rover}>Rover</option>
          <option value={VehicleType.Sub}>Sub</option>
        </select>
        <span>Mode channel:</span>
        <select
          className={styles.channelSelect}
          value={modeChannel}
          onChange={(e) => handleChannelChange(Number(e.target.value))}
        >
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Channel {i + 1}
            </option>
          ))}
        </select>
        <span className={styles.paramHint}>{chParam}</span>
      </div>

      <div className={styles.modeGrid}>
        {modes.map((modeNumber, i) => {
          const slot = i + 1
          const range = ARDU_PWM_RANGES[i]!
          const isActive = activeSlot === slot
          return (
            <div key={slot} className={`${styles.modeRow} ${isActive ? styles.modeRowActive : ''}`}>
              <span className={styles.slotBadge}>{slot}</span>
              <select
                className={styles.modeSelect}
                value={modeNumber}
                onChange={(e) => handleModeChange(slot, Number(e.target.value))}
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {showSimple && (
                <>
                  <label className={styles.modeCheckbox}>
                    <input
                      type="checkbox"
                      checked={(simpleBitmask & (1 << i)) !== 0}
                      onChange={(e) => handleSimpleToggle(slot, e.target.checked)}
                    />
                    Simple
                  </label>
                  <label className={styles.modeCheckbox}>
                    <input
                      type="checkbox"
                      checked={(superSimpleBitmask & (1 << i)) !== 0}
                      onChange={(e) => handleSuperSimpleToggle(slot, e.target.checked)}
                    />
                    Super Simple
                  </label>
                </>
              )}
              <span className={styles.modePwmRange}>
                {range.min}–{range.max}
              </span>
            </div>
          )
        })}
      </div>

      {modeChannelPwm > 0 && (
        <div className={styles.activePwm}>
          CH{modeChannel} PWM: {modeChannelPwm} → Slot {activeSlot}
        </div>
      )}

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
          <button className={styles.btn} onClick={handleDiscard}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Main entry — detect autopilot type ────── */

export function FlightModesPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicles = useVehicleStore((s) => s.vehicles)
  const autopilot = activeVehicleId ? vehicles[activeVehicleId]?.core?.autopilot : undefined
  const isPX4 = autopilot === MAV_AUTOPILOT_PX4

  return isPX4 ? <PX4FlightModesPage /> : <ArduPilotFlightModesPage />
}
