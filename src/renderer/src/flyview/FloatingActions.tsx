import { useState, useCallback, useRef } from 'react'
import { useCommand } from '../hooks/useCommand'
import { useMission } from '../hooks/useMission'
import { useTelemetry } from '../hooks/useVehicle'
import { useMissionStore } from '../store/missionStore'
import styles from './FloatingActions.module.css'

/* ── Icons ───────────────────────────────────────── */

function TakeoffIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 19V7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M7 12L12 5L17 12"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="5"
        y1="21"
        x2="19"
        y2="21"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  )
}

function LandIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 5V17" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M7 12L12 19L17 12"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="5"
        y1="21"
        x2="19"
        y2="21"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  )
}

function RtlIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      {/* House */}
      <path
        d="M12 3L4 10H7V17H17V10H20L12 3Z"
        stroke={color}
        strokeWidth="1.8"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Arrow curving back */}
      <path
        d="M20 7L20 3L16 3"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  )
}

function PauseIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
      <rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
    </svg>
  )
}

function MissionIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      {/* Waypoint path */}
      <circle cx="6" cy="6" r="2.5" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="18" cy="10" r="2.5" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="10" cy="18" r="2.5" stroke={color} strokeWidth="1.5" fill="none" />
      <line
        x1="8"
        y1="7"
        x2="16"
        y2="9"
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray="2 2"
        opacity="0.5"
      />
      <line
        x1="16"
        y1="11.5"
        x2="12"
        y2="16"
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray="2 2"
        opacity="0.5"
      />
    </svg>
  )
}

function StopIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="2" fill={color} opacity="0.9" />
    </svg>
  )
}

/* ── Hold Button (inline for floating context) ───── */

function ActionButton({
  icon,
  label,
  color,
  onConfirm,
  disabled,
  holdMs = 1500
}: {
  icon: React.JSX.Element
  label: string
  color: string
  onConfirm: () => void
  disabled?: boolean
  holdMs?: number
}): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const confirmedRef = useRef(false)

  const tick = useCallback(() => {
    if (startTimeRef.current === null) return
    const elapsed = Date.now() - startTimeRef.current
    const pct = Math.min(elapsed / holdMs, 1)
    setProgress(pct)
    if (pct >= 1 && !confirmedRef.current) {
      confirmedRef.current = true
      onConfirm()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [holdMs, onConfirm])

  const handleDown = useCallback(() => {
    if (disabled) return
    confirmedRef.current = false
    startTimeRef.current = Date.now()
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick, disabled])

  const handleUp = useCallback(() => {
    startTimeRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setProgress(0)
  }, [])

  return (
    <button
      className={styles.actionBtn}
      style={{ borderColor: color }}
      disabled={disabled}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      onPointerCancel={handleUp}
    >
      <span
        className={styles.holdFill}
        style={{
          background: color,
          transform: `scaleX(${progress})`,
          transition: progress === 0 ? 'transform 0.15s' : 'none'
        }}
      />
      {icon}
      <span className={styles.btnLabel} style={{ color }}>
        {label}
      </span>
    </button>
  )
}

/* ── Main Widget ─────────────────────────────────── */

export function FloatingActions(): React.JSX.Element | null {
  const { guidedTakeoff, guidedRTL, guidedLand, guidedPause, setFlightMode, emergencyStop } =
    useCommand()
  const { uploadMission } = useMission()
  const core = useTelemetry('core')
  const extState = useTelemetry('extendedState')
  const armed = core?.armed ?? false
  // MAV_LANDED_STATE: 0=undefined, 1=on_ground, 2=in_air, 3=takeoff, 4=landing
  const flying = armed && extState != null && extState.landedState >= 2
  const modeName = core?.flightModeName ?? ''
  const isAutoMission = modeName === 'Auto:Mission' || modeName === 'Auto'
  const waypointCount = useMissionStore((s) => s.editableWaypoints.length)
  const [expanded, setExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!core || core.communicationLost) return null

  const startMission = async (): Promise<void> => {
    setUploading(true)
    setError(null)
    try {
      if (waypointCount > 0) {
        const result = await uploadMission()
        if (result && typeof result === 'object' && 'error' in result) {
          setError('Mission upload failed')
          return
        }
      }
      const modeResult = await setFlightMode('Mission')
      if (modeResult !== undefined && modeResult !== 0) {
        setError('Failed to set Mission mode')
      }
    } catch {
      setError('Failed to start mission')
    } finally {
      setUploading(false)
    }
  }

  const doTakeoff = async (): Promise<void> => {
    setError(null)
    try {
      const result = await guidedTakeoff(10)
      if (result !== undefined && result !== 0) setError('Takeoff failed')
    } catch {
      setError('Takeoff failed')
    }
  }

  // Determine which actions to show based on state
  // Primary: always-visible top 3
  // Secondary: shown when expanded
  type Action = {
    key: string
    icon: React.JSX.Element
    label: string
    color: string
    onConfirm: () => void
    disabled?: boolean
  }

  const primary: Action[] = []
  const secondary: Action[] = []

  if (!armed) {
    // Pre-flight: Takeoff is the main action
    primary.push({
      key: 'takeoff',
      icon: <TakeoffIcon color="#4a9eff" />,
      label: 'Takeoff',
      color: '#4a9eff',
      onConfirm: doTakeoff
    })
  } else {
    // In-flight primary: RTL, Land, Pause (most critical)
    primary.push({
      key: 'rtl',
      icon: <RtlIcon color="#ffaa00" />,
      label: 'RTL',
      color: '#ffaa00',
      onConfirm: () => guidedRTL()
    })
    primary.push({
      key: 'land',
      icon: <LandIcon color="#ff5252" />,
      label: 'Land',
      color: '#ff5252',
      onConfirm: () => guidedLand()
    })
    primary.push({
      key: 'pause',
      icon: <PauseIcon color="#aaaaaa" />,
      label: 'Pause',
      color: '#aaaaaa',
      onConfirm: () => guidedPause()
    })

    // Secondary: Mission start, Emergency Stop
    if (!isAutoMission) {
      secondary.push({
        key: 'mission',
        icon: <MissionIcon color="#44cc44" />,
        label: uploading ? 'Upload...' : 'Mission',
        color: '#44cc44',
        onConfirm: startMission,
        disabled: uploading
      })
    }
    if (flying) {
      secondary.push({
        key: 'estop',
        icon: <StopIcon color="#ff0000" />,
        label: 'E-Stop',
        color: '#ff0000',
        onConfirm: () => emergencyStop()
      })
    }
  }

  return (
    <div className={styles.root}>
      {error && (
        <div className={styles.error} onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className={styles.primaryActions}>
        {primary.map((a) => (
          <ActionButton
            key={a.key}
            icon={a.icon}
            label={a.label}
            color={a.color}
            onConfirm={a.onConfirm}
            disabled={a.disabled}
          />
        ))}
      </div>

      {secondary.length > 0 && (
        <>
          <div className={styles.separator} />
          {expanded ? (
            <div className={styles.moreActions}>
              {secondary.map((a) => (
                <ActionButton
                  key={a.key}
                  icon={a.icon}
                  label={a.label}
                  color={a.color}
                  onConfirm={a.onConfirm}
                  disabled={a.disabled}
                />
              ))}
              <button className={styles.expandBtn} onClick={() => setExpanded(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M15 18L9 12L15 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <button className={styles.expandBtn} onClick={() => setExpanded(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="6" r="1.5" fill="currentColor" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                <circle cx="12" cy="18" r="1.5" fill="currentColor" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  )
}
