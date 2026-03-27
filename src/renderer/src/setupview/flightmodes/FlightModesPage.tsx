import { useState, useEffect, useCallback, useMemo } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useParameterStore } from '../../store/parameterStore'
import {
  VehicleType,
  getModeNamesForVehicleType
} from '../../../../shared-types/ipc/SetupTypes'
import styles from './FlightModesPage.module.css'

/** ArduPilot PWM ranges for 6 flight mode slots */
const PWM_RANGES = [
  { min: 0, max: 1230 },
  { min: 1231, max: 1360 },
  { min: 1361, max: 1490 },
  { min: 1491, max: 1620 },
  { min: 1621, max: 1749 },
  { min: 1750, max: 2200 }
]

/** Determine which mode slot (1-6) is active for a given PWM value */
function activeSlotForPwm(pwm: number): number {
  for (let i = 0; i < PWM_RANGES.length; i++) {
    if (pwm <= PWM_RANGES[i]!.max) return i + 1
  }
  return 6
}

export function FlightModesPage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicleId = activeVehicleId ?? 1
  const parameters = useParameterStore((s) => s.parameters)
  const rc = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid]?.rc : undefined
  })

  // Vehicle type detection — default to Copter, allow manual override
  const [vehicleType, setVehicleType] = useState<VehicleType>(VehicleType.Copter)

  const modeNames = useMemo(() => getModeNamesForVehicleType(vehicleType), [vehicleType])
  const MODE_OPTIONS = useMemo(
    () =>
      Object.entries(modeNames)
        .map(([num, name]) => ({ value: Number(num), label: `${num} - ${name}` }))
        .sort((a, b) => a.value - b.value),
    [modeNames]
  )

  // Read current config from parameters
  const savedModeChannel = parameters.get('FLTMODE_CH')?.value ?? 5
  const savedModes = useMemo(() => {
    const m: number[] = []
    for (let i = 1; i <= 6; i++) {
      m.push(parameters.get(`FLTMODE${i}`)?.value ?? 0)
    }
    return m
  }, [parameters])

  // Read SIMPLE / SUPER_SIMPLE bitmask parameters
  const savedSimpleBitmask = parameters.get('SIMPLE')?.value ?? 0
  const savedSuperSimpleBitmask = parameters.get('SUPER_SIMPLE')?.value ?? 0

  // Local editing state
  const [modeChannel, setModeChannel] = useState(savedModeChannel)
  const [modes, setModes] = useState<number[]>(savedModes)
  const [simpleBitmask, setSimpleBitmask] = useState(savedSimpleBitmask)
  const [superSimpleBitmask, setSuperSimpleBitmask] = useState(savedSuperSimpleBitmask)
  const [hasChanges, setHasChanges] = useState(false)

  // Sync from parameters when they change
  useEffect(() => {
    setModeChannel(savedModeChannel)
    setModes(savedModes)
    setSimpleBitmask(savedSimpleBitmask)
    setSuperSimpleBitmask(savedSuperSimpleBitmask)
    setHasChanges(false)
  }, [savedModeChannel, savedModes, savedSimpleBitmask, savedSuperSimpleBitmask])

  // Current PWM on the mode channel
  const modeChannelPwm = rc?.channels[(modeChannel - 1)] ?? 0
  const activeSlot = modeChannelPwm > 0 ? activeSlotForPwm(modeChannelPwm) : 0

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
    setSimpleBitmask((prev) => checked ? prev | (1 << (slot - 1)) : prev & ~(1 << (slot - 1)))
    setHasChanges(true)
  }, [])

  const handleSuperSimpleToggle = useCallback((slot: number, checked: boolean) => {
    setSuperSimpleBitmask((prev) => checked ? prev | (1 << (slot - 1)) : prev & ~(1 << (slot - 1)))
    setHasChanges(true)
  }, [])

  const handleSave = useCallback(async () => {
    const bridge = window.qgcBridge
    if (!bridge) return
    await bridge.flightModesSet(vehicleId, {
      modeChannel,
      modes: modes.map((modeNumber, i) => ({
        slot: i + 1,
        modeNumber,
        modeName: modeNames[modeNumber] ?? `Mode ${modeNumber}`
      })),
      activeSlot
    })
    // Save Simple / SuperSimple bitmasks
    await bridge.setParameter(vehicleId, 'SIMPLE', simpleBitmask)
    await bridge.setParameter(vehicleId, 'SUPER_SIMPLE', superSimpleBitmask)
    setHasChanges(false)
  }, [vehicleId, modeChannel, modes, activeSlot, simpleBitmask, superSimpleBitmask])

  return (
    <div className={styles.root}>
      <div className={styles.title}>Flight Modes</div>

      <div className={styles.channelSelector}>
        <span>Vehicle type:</span>
        <select
          className={styles.channelSelect}
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
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
      </div>

      <div className={styles.modeGrid}>
        {modes.map((modeNumber, i) => {
          const slot = i + 1
          const range = PWM_RANGES[i]!
          const isActive = activeSlot === slot
          return (
            <div
              key={slot}
              className={`${styles.modeRow} ${isActive ? styles.modeRowActive : ''}`}
            >
              <span className={styles.modeSlot}>Mode {slot}</span>
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
              <span className={styles.modePwmRange}>
                {range.min}–{range.max}
              </span>
            </div>
          )
        })}
      </div>

      {modeChannelPwm > 0 && (
        <div className={styles.activePwm}>
          CH{modeChannel} PWM: {modeChannelPwm} (Slot {activeSlot})
        </div>
      )}

      <div className={styles.toolbar}>
        {hasChanges && (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            Save
          </button>
        )}
      </div>
    </div>
  )
}
