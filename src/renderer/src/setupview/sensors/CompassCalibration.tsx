import { useEffect, useRef } from 'react'
import type { MagCalReport } from '../../../../shared-types/ipc/SetupTypes'
import {
  CalibrationStatus,
  CalibrationOrientation
} from '../../../../shared-types/ipc/SetupTypes'
import type { CalibrationState } from '../../../../shared-types/ipc/SetupTypes'
import { useSetupStore } from '../../store/setupStore'
import styles from './CompassCalibration.module.css'

/* ── Per-orientation SVG aircraft views ──────────────── */

const V = 'rgba(255,255,255,' // shorthand for vehicle color
const A = 'rgba(100,180,255,' // accent color (cockpit)
const G = 'rgba(80,220,130,'  // green highlight for front indicator

/** Top-down view — level / right-side-up */
function VehicleLevel(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      {/* Fuselage */}
      <path d="M60 8 L54 22 L54 68 L50 80 L70 80 L66 68 L66 22 Z"
        fill={`${V}0.85)`} stroke={`${V}0.3)`} strokeWidth="0.5" />
      {/* Left wing */}
      <path d="M54 40 L8 52 L8 56 L54 47 Z"
        fill={`${V}0.7)`} stroke={`${V}0.2)`} strokeWidth="0.5" />
      {/* Right wing */}
      <path d="M66 40 L112 52 L112 56 L66 47 Z"
        fill={`${V}0.7)`} stroke={`${V}0.2)`} strokeWidth="0.5" />
      {/* Left tail */}
      <path d="M50 72 L32 78 L32 81 L50 76 Z"
        fill={`${V}0.5)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
      {/* Right tail */}
      <path d="M70 72 L88 78 L88 81 L70 76 Z"
        fill={`${V}0.5)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
      {/* Vertical stabilizer */}
      <path d="M57 66 L57 80 L63 80 L63 66 Z"
        fill={`${V}0.6)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
      {/* Propeller */}
      <ellipse cx="60" cy="8" rx="12" ry="2.5" fill={`${V}0.35)`} />
      {/* Cockpit */}
      <ellipse cx="60" cy="24" rx="3" ry="5" fill={`${A}0.4)`} />
      {/* Front marker arrow */}
      <polygon points="60,2 57,8 63,8" fill={`${G}0.6)`} />
    </svg>
  )
}

/** Upside-down: belly-up view */
function VehicleUpsideDown(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      {/* Flipped vertically — nose at bottom */}
      <g transform="scale(1,-1) translate(0,-92)">
        <path d="M60 8 L54 22 L54 68 L50 80 L70 80 L66 68 L66 22 Z"
          fill={`${V}0.7)`} stroke={`${V}0.2)`} strokeWidth="0.5" />
        <path d="M54 40 L8 52 L8 56 L54 47 Z"
          fill={`${V}0.6)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
        <path d="M66 40 L112 52 L112 56 L66 47 Z"
          fill={`${V}0.6)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
        <path d="M50 72 L32 78 L32 81 L50 76 Z"
          fill={`${V}0.45)`} stroke={`${V}0.1)`} strokeWidth="0.5" />
        <path d="M70 72 L88 78 L88 81 L70 76 Z"
          fill={`${V}0.45)`} stroke={`${V}0.1)`} strokeWidth="0.5" />
        <path d="M57 66 L57 80 L63 80 L63 66 Z"
          fill={`${V}0.5)`} stroke={`${V}0.1)`} strokeWidth="0.5" />
        <ellipse cx="60" cy="8" rx="12" ry="2.5" fill={`${V}0.25)`} />
      </g>
      {/* "BELLY UP" indicator — X marks on belly */}
      <line x1="55" y1="44" x2="65" y2="52" stroke={`${V}0.2)`} strokeWidth="1" />
      <line x1="65" y1="44" x2="55" y2="52" stroke={`${V}0.2)`} strokeWidth="1" />
      {/* Ground reference */}
      <line x1="15" y1="96" x2="105" y2="96" stroke={`${V}0.12)`} strokeWidth="1" strokeDasharray="4 3" />
    </svg>
  )
}

/** Nose-down: front of vehicle pointing downward */
function VehicleNoseDown(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      <g transform="rotate(-40 60 50)">
        <path d="M60 10 L55 22 L55 62 L52 72 L68 72 L65 62 L65 22 Z"
          fill={`${V}0.8)`} stroke={`${V}0.25)`} strokeWidth="0.5" />
        <path d="M55 36 L12 46 L12 50 L55 42 Z"
          fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
        <path d="M65 36 L108 46 L108 50 L65 42 Z"
          fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
        <path d="M52 66 L36 72 L36 74 L52 69 Z"
          fill={`${V}0.5)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
        <path d="M68 66 L84 72 L84 74 L68 69 Z"
          fill={`${V}0.5)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
        <ellipse cx="60" cy="10" rx="11" ry="2.5" fill={`${V}0.3)`} />
        <ellipse cx="60" cy="24" rx="2.5" ry="4" fill={`${A}0.3)`} />
        <polygon points="60,4 57,10 63,10" fill={`${G}0.5)`} />
      </g>
      {/* Ground & down arrow */}
      <line x1="15" y1="96" x2="105" y2="96" stroke={`${V}0.12)`} strokeWidth="1" strokeDasharray="4 3" />
      <polygon points="60,92 56,86 64,86" fill={`${G}0.4)`} />
    </svg>
  )
}

/** Nose-up (tail down): front of vehicle pointing upward */
function VehicleNoseUp(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      <g transform="rotate(40 60 50)">
        <path d="M60 10 L55 22 L55 62 L52 72 L68 72 L65 62 L65 22 Z"
          fill={`${V}0.8)`} stroke={`${V}0.25)`} strokeWidth="0.5" />
        <path d="M55 36 L12 46 L12 50 L55 42 Z"
          fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
        <path d="M65 36 L108 46 L108 50 L65 42 Z"
          fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
        <path d="M52 66 L36 72 L36 74 L52 69 Z"
          fill={`${V}0.5)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
        <path d="M68 66 L84 72 L84 74 L68 69 Z"
          fill={`${V}0.5)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
        <ellipse cx="60" cy="10" rx="11" ry="2.5" fill={`${V}0.3)`} />
        <polygon points="60,4 57,10 63,10" fill={`${G}0.5)`} />
      </g>
      {/* Ground & up arrow */}
      <line x1="15" y1="96" x2="105" y2="96" stroke={`${V}0.12)`} strokeWidth="1" strokeDasharray="4 3" />
      <polygon points="60,10 56,16 64,16" fill={`${G}0.4)`} />
    </svg>
  )
}

/** Left side: profile view from the left — right wing down */
function VehicleLeftSide(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      {/* Side profile fuselage */}
      <path d="M18 48 L26 40 L85 38 L98 42 L100 48 L96 52 L85 54 L24 54 Z"
        fill={`${V}0.8)`} stroke={`${V}0.25)`} strokeWidth="0.5" />
      {/* Wing edge (seen from side) */}
      <path d="M40 54 L68 54 L64 62 L44 62 Z"
        fill={`${V}0.5)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
      {/* Vertical stabilizer */}
      <path d="M88 38 L93 22 L100 22 L100 38 Z"
        fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
      {/* Horizontal stabilizer */}
      <path d="M88 42 L104 40 L106 42 L104 44 L88 44 Z"
        fill={`${V}0.45)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
      {/* Propeller disc */}
      <line x1="18" y1="36" x2="18" y2="60" stroke={`${V}0.35)`} strokeWidth="2" strokeLinecap="round" />
      {/* Cockpit canopy */}
      <path d="M32 40 L36 36 L46 36 L48 40 Z"
        fill={`${A}0.3)`} stroke={`${A}0.15)`} strokeWidth="0.5" />
      {/* Landing gear */}
      <line x1="38" y1="54" x2="35" y2="64" stroke={`${V}0.3)`} strokeWidth="1.5" />
      <line x1="80" y1="54" x2="77" y2="64" stroke={`${V}0.3)`} strokeWidth="1.5" />
      <circle cx="35" cy="65" r="2" fill={`${V}0.25)`} />
      <circle cx="77" cy="65" r="2" fill={`${V}0.25)`} />
      {/* Front arrow */}
      <polygon points="12,48 18,44 18,52" fill={`${G}0.5)`} />
      {/* Ground */}
      <line x1="15" y1="96" x2="105" y2="96" stroke={`${V}0.12)`} strokeWidth="1" strokeDasharray="4 3" />
      {/* Tilt indicator */}
      <text x="60" y="82" textAnchor="middle" fill={`${V}0.25)`} fontSize="8" fontFamily="monospace">LEFT</text>
    </svg>
  )
}

/** Right side: profile from the right (mirrored left) */
function VehicleRightSide(): React.JSX.Element {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100">
      <g transform="scale(-1,1) translate(-120,0)">
        {/* Mirrored left-side profile */}
        <path d="M18 48 L26 40 L85 38 L98 42 L100 48 L96 52 L85 54 L24 54 Z"
          fill={`${V}0.8)`} stroke={`${V}0.25)`} strokeWidth="0.5" />
        <path d="M40 54 L68 54 L64 62 L44 62 Z"
          fill={`${V}0.5)`} stroke={`${V}0.15)`} strokeWidth="0.5" />
        <path d="M88 38 L93 22 L100 22 L100 38 Z"
          fill={`${V}0.65)`} stroke={`${V}0.18)`} strokeWidth="0.5" />
        <path d="M88 42 L104 40 L106 42 L104 44 L88 44 Z"
          fill={`${V}0.45)`} stroke={`${V}0.12)`} strokeWidth="0.5" />
        <line x1="18" y1="36" x2="18" y2="60" stroke={`${V}0.35)`} strokeWidth="2" strokeLinecap="round" />
        <path d="M32 40 L36 36 L46 36 L48 40 Z"
          fill={`${A}0.3)`} stroke={`${A}0.15)`} strokeWidth="0.5" />
        <line x1="38" y1="54" x2="35" y2="64" stroke={`${V}0.3)`} strokeWidth="1.5" />
        <line x1="80" y1="54" x2="77" y2="64" stroke={`${V}0.3)`} strokeWidth="1.5" />
        <circle cx="35" cy="65" r="2" fill={`${V}0.25)`} />
        <circle cx="77" cy="65" r="2" fill={`${V}0.25)`} />
        <polygon points="12,48 18,44 18,52" fill={`${G}0.5)`} />
      </g>
      {/* Ground */}
      <line x1="15" y1="96" x2="105" y2="96" stroke={`${V}0.12)`} strokeWidth="1" strokeDasharray="4 3" />
      <text x="60" y="82" textAnchor="middle" fill={`${V}0.25)`} fontSize="8" fontFamily="monospace">RIGHT</text>
    </svg>
  )
}

/* ── Orientation metadata ───────────────────────────── */

const ORIENTATIONS: Array<{
  id: CalibrationOrientation
  label: string
  View: () => React.JSX.Element
}> = [
  { id: CalibrationOrientation.Level, label: 'Level', View: VehicleLevel },
  { id: CalibrationOrientation.UpsideDown, label: 'Upside Down', View: VehicleUpsideDown },
  { id: CalibrationOrientation.NoseDown, label: 'Nose Down', View: VehicleNoseDown },
  { id: CalibrationOrientation.NoseUp, label: 'Tail Down', View: VehicleNoseUp },
  { id: CalibrationOrientation.LeftSide, label: 'Left Side', View: VehicleLeftSide },
  { id: CalibrationOrientation.RightSide, label: 'Right Side', View: VehicleRightSide }
]

/* ── Orientation card ────────────────────────────────── */

function OrientationCard({
  label,
  View,
  status,
  progress
}: {
  label: string
  View: () => React.JSX.Element
  status: 'pending' | 'active' | 'done'
  progress: number
}): React.JSX.Element {
  const cardClass = `${styles.card} ${
    status === 'done' ? styles.cardDone : status === 'active' ? styles.cardActive : styles.cardPending
  }`

  return (
    <div className={cardClass}>
      <div className={styles.vehicleScene}>
        <View />
        {/* Rotation arrow overlay for active card */}
        {status === 'active' && (
          <div className={styles.rotateArrow}>
            <svg width="120" height="100" viewBox="0 0 120 100">
              <defs>
                <linearGradient id="rotGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00c853" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#69f0ae" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <path d="M60 6 A44 44 0 1 1 24 72" fill="none"
                stroke="url(#rotGrad)" strokeWidth="4" strokeLinecap="round" />
              <polygon points="18,64 24,78 32,66" fill="#69f0ae" />
            </svg>
          </div>
        )}
      </div>

      {/* Progress ring on active card */}
      {status === 'active' && (
        <div className={styles.progressRingWrap}>
          <svg width="36" height="36" viewBox="0 0 36 36" className={styles.progressRing}>
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="#69f0ae" strokeWidth="2.5"
              strokeLinecap="round" strokeDasharray={`${progress * 94.25} 94.25`}
              transform="rotate(-90 18 18)" className={styles.progressArc} />
            <text x="18" y="18" textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize="8" fontFamily="monospace">
              {Math.round(progress * 100)}%
            </text>
          </svg>
        </div>
      )}

      {/* Check mark for completed */}
      {status === 'done' && (
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="#00e676" strokeWidth="2" />
          <polyline points="7,12 10,16 17,8" fill="none" stroke="#00e676" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      <span className={styles.cardLabel}>
        {status === 'done' ? 'Done' : status === 'active' ? 'Rotate' : 'Pending'}
      </span>
      <span className={styles.cardOrientation}>{label}</span>
    </div>
  )
}

/* ── Compass progress ring (per-compass, ArduPilot) ──── */

function CompassRing({
  compassId,
  progress,
  report,
  isCalibrating
}: {
  compassId: number
  progress: number
  report?: MagCalReport
  isCalibrating: boolean
}): React.JSX.Element {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference
  const isSuccess = report && report.calStatus === 4
  const isFailed = report && report.calStatus === 5

  const strokeColor = isSuccess
    ? '#00e676'
    : isFailed
      ? '#ff5252'
      : isCalibrating
        ? '#4a9eff'
        : 'rgba(255,255,255,0.15)'

  return (
    <div className={styles.compassRing}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        <circle cx="48" cy="48" r={radius} fill="none" stroke={strokeColor} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={offset}
          transform="rotate(-90 48 48)" className={styles.compassArc} />
        {isCalibrating && progress > 0 && (
          <circle cx="48" cy="48" r={radius} fill="none" stroke={strokeColor} strokeWidth="8"
            strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={offset}
            transform="rotate(-90 48 48)" opacity="0.15" filter="blur(4px)" />
        )}
        {report ? (
          <>
            <text x="48" y="40" textAnchor="middle" dominantBaseline="central"
              fill={isSuccess ? '#00e676' : '#ff5252'} fontSize="12" fontFamily="monospace" fontWeight="600">
              {isSuccess ? 'PASS' : 'FAIL'}
            </text>
            {isSuccess && (
              <text x="48" y="56" textAnchor="middle" dominantBaseline="central"
                fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="monospace">
                {report.fitness.toFixed(2)}
              </text>
            )}
          </>
        ) : (
          <text x="48" y="48" textAnchor="middle" dominantBaseline="central"
            fill="#fff" fontSize="16" fontFamily="monospace" fontWeight="600">
            {Math.round(progress)}%
          </text>
        )}
      </svg>
      <span className={styles.compassLabel}>Compass {compassId}</span>
    </div>
  )
}

/* ── Main compass calibration component ──────────────── */

interface Props {
  state: CalibrationState
  onCancel: () => void
  onDone: () => void
}

export function CompassCalibration({ state, onCancel, onDone }: Props): React.JSX.Element {
  const magCalProgress = useSetupStore((s) => s.magCalProgress)
  const magCalReports = useSetupStore((s) => s.magCalReports)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isFinished =
    state.status === CalibrationStatus.Complete ||
    state.status === CalibrationStatus.Failed ||
    state.status === CalibrationStatus.Cancelled

  const isCalibrating =
    state.status === CalibrationStatus.Collecting ||
    state.status === CalibrationStatus.Started ||
    state.status === CalibrationStatus.WaitingForOrientation

  // Auto-scroll message log
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length])

  const statusLabel =
    state.status === CalibrationStatus.Complete
      ? 'Calibration Complete'
      : state.status === CalibrationStatus.Failed
        ? 'Calibration Failed'
        : state.status === CalibrationStatus.Cancelled
          ? 'Calibration Cancelled'
          : state.status === CalibrationStatus.WaitingForOrientation
            ? 'Place vehicle on a pending side and hold still'
            : state.status === CalibrationStatus.Collecting
              ? 'Rotate the vehicle slowly on the current axis'
              : 'Starting compass calibration...'

  // Determine per-card state from orientation tracking
  const hasOrientationTracking =
    state.orientationsCompleted.length > 0 || state.currentOrientation !== null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h2 className={styles.title}>COMPASS CALIBRATION</h2>
        <p className={`${styles.subtitle} ${
          state.status === CalibrationStatus.Complete ? styles.subtitleSuccess
            : state.status === CalibrationStatus.Failed ? styles.subtitleError : ''
        }`}>
          {statusLabel}
        </p>
      </div>

      <div className={styles.content}>
        {/* 6-orientation grid — driven by backend orientation tracking */}
        <div className={styles.orientationGrid}>
          {ORIENTATIONS.map(({ id, label, View }) => {
            let cardStatus: 'pending' | 'active' | 'done'
            let cardProgress = 0

            if (isFinished) {
              cardStatus = state.status === CalibrationStatus.Complete ? 'done' : 'pending'
            } else if (hasOrientationTracking) {
              // PX4-style: use actual orientation state
              if (state.orientationsCompleted.includes(id)) {
                cardStatus = 'done'
              } else if (state.currentOrientation === id) {
                cardStatus = 'active'
                cardProgress = state.currentOrientationProgress
              } else {
                cardStatus = 'pending'
              }
            } else {
              // ArduPilot fallback: derive from overall progress
              const pct = state.progress * 100
              const idx = ORIENTATIONS.findIndex((o) => o.id === id)
              const slotStart = (idx / 6) * 100
              const slotEnd = ((idx + 1) / 6) * 100
              if (pct >= slotEnd) {
                cardStatus = 'done'
              } else if (pct >= slotStart) {
                cardStatus = 'active'
                cardProgress = (pct - slotStart) / (slotEnd - slotStart)
              } else {
                cardStatus = 'pending'
              }
            }

            return (
              <OrientationCard
                key={id}
                label={label}
                View={View}
                status={cardStatus}
                progress={cardProgress}
              />
            )
          })}
        </div>

        {/* Per-compass progress rings (ArduPilot MAG_CAL_PROGRESS) */}
        {(magCalProgress.length > 0 || magCalReports.length > 0) && (
          <div className={styles.compassSection}>
            <div className={styles.compassRings}>
              {(magCalProgress.length > 0 ? magCalProgress : magCalReports).map((item) => {
                const compassId = item.compassId
                const prog = magCalProgress.find((p) => p.compassId === compassId)
                const report = magCalReports.find((r) => r.compassId === compassId)
                return (
                  <CompassRing key={compassId} compassId={compassId}
                    progress={prog?.completionPct ?? (report ? 100 : 0)}
                    report={report} isCalibrating={isCalibrating} />
                )
              })}
            </div>
          </div>
        )}

        {/* Overall progress bar */}
        <div className={styles.overallProgress}>
          <div className={styles.progressTrack}>
            <div className={`${styles.progressFill} ${
              state.status === CalibrationStatus.Complete ? styles.progressSuccess
                : state.status === CalibrationStatus.Failed ? styles.progressError : ''
            }`} style={{ width: `${(state.progress * 100).toFixed(0)}%` }} />
          </div>
        </div>
      </div>

      {/* Message log */}
      <div className={styles.messageLog}>
        {state.messages.map((msg, i) => (
          <div key={i} className={styles.messageLine}>{msg}</div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {isFinished ? (
          <button className={styles.doneBtn} onClick={onDone}>Done</button>
        ) : (
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        )}
      </div>
    </div>
  )
}
