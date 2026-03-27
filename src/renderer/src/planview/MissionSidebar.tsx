import { useMissionStore } from '../store/missionStore'
import { AltitudeMode } from '../../../shared-types/ipc/MissionTypes'
import { WaypointEditor } from './WaypointEditor'
import { MissionStatsPanel } from './MissionStatsPanel'
import styles from './MissionSidebar.module.css'

function altModeLabel(mode: AltitudeMode): string {
  switch (mode) {
    case AltitudeMode.Relative:
      return 'REL'
    case AltitudeMode.AMSL:
      return 'AMSL'
    default:
      return '?'
  }
}

export function MissionSidebar(): React.JSX.Element {
  const waypoints = useMissionStore((s) => s.editableWaypoints)
  const selectedSeq = useMissionStore((s) => s.selectedWaypointSeq)
  const selectWaypoint = useMissionStore((s) => s.selectWaypoint)
  const removeWaypoint = useMissionStore((s) => s.removeWaypoint)

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>MISSION</span>
        <span className={styles.headerCount}>
          {waypoints.length} WP{waypoints.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Waypoint list */}
      <div className={styles.list}>
        {waypoints.length === 0 && (
          <div className={styles.emptyMsg}>Click map to add waypoints</div>
        )}
        {waypoints.map((wp) => {
          const isSelected = wp.seq === selectedSeq
          return (
            <div
              key={wp.seq}
              data-testid={`wp-item-${wp.seq}`}
              onClick={() => selectWaypoint(wp.seq)}
              className={`${styles.wpItem} ${isSelected ? styles.wpItemSelected : ''}`}
            >
              <div className={`${styles.seqBadge} ${isSelected ? styles.seqBadgeSelected : ''}`}>
                {wp.seq}
              </div>

              <div className={styles.wpInfo}>
                <div className={styles.wpCoords}>
                  {wp.lat.toFixed(6)}, {wp.lon.toFixed(6)}
                </div>
                <div className={styles.wpAlt}>
                  {wp.alt}m {altModeLabel(wp.altMode)}
                </div>
              </div>

              <button
                data-testid={`wp-delete-${wp.seq}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removeWaypoint(wp.seq)
                }}
                className={styles.deleteBtn}
              >
                X
              </button>
            </div>
          )
        })}
      </div>

      <div className={styles.bottomSection}>
        <WaypointEditor />
      </div>

      <div className={styles.bottomSection}>
        <MissionStatsPanel />
      </div>
    </div>
  )
}
