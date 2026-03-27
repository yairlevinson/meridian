import { useMissionStore } from '../store/missionStore'
import { AltitudeMode } from '../../../shared-types/ipc/MissionTypes'
import styles from './WaypointEditor.module.css'

export function WaypointEditor(): React.JSX.Element | null {
  const selectedSeq = useMissionStore((s) => s.selectedWaypointSeq)
  const waypoints = useMissionStore((s) => s.editableWaypoints)
  const updateAlt = useMissionStore((s) => s.updateWaypointAlt)
  const updateAltMode = useMissionStore((s) => s.updateWaypointAltMode)
  const removeWaypoint = useMissionStore((s) => s.removeWaypoint)

  if (selectedSeq == null) return null

  const wp = waypoints.find((w) => w.seq === selectedSeq)
  if (!wp) return null

  return (
    <div className={styles.root}>
      <div className={styles.title}>Edit WP {wp.seq}</div>

      <div>
        <div className={styles.label}>Lat / Lon</div>
        <div className={styles.coordText}>
          {wp.lat.toFixed(6)}, {wp.lon.toFixed(6)}
        </div>
      </div>

      <div>
        <div className={styles.label}>Altitude (m)</div>
        <input
          type="number"
          value={wp.alt}
          onChange={(e) => updateAlt(wp.seq, Number(e.target.value))}
          className="input"
          data-testid="wp-alt-input"
        />
      </div>

      <div>
        <div className={styles.label}>Alt Mode</div>
        <select
          value={wp.altMode}
          onChange={(e) => updateAltMode(wp.seq, Number(e.target.value) as AltitudeMode)}
          className="input"
          style={{ cursor: 'pointer' }}
          data-testid="wp-altmode-select"
        >
          <option value={AltitudeMode.Relative}>Relative</option>
          <option value={AltitudeMode.AMSL}>AMSL</option>
        </select>
      </div>

      <button onClick={() => removeWaypoint(wp.seq)} className={styles.deleteBtn}>
        Delete Waypoint
      </button>
    </div>
  )
}
