import { useMissionStore } from '../store/missionStore'
import { AltitudeMode } from '../../../shared-types/ipc/MissionTypes'
import styles from './WaypointEditor.module.css'

const WAYPOINT_COMMANDS = [
  { value: 16, name: 'Waypoint' },
  { value: 17, name: 'Loiter Unlim' },
  { value: 18, name: 'Loiter Turns' },
  { value: 19, name: 'Loiter Time' },
  { value: 20, name: 'Return to Launch' },
  { value: 21, name: 'Land' },
  { value: 22, name: 'Takeoff' },
  { value: 82, name: 'Spline WP' },
  { value: 177, name: 'Do Jump' },
  { value: 178, name: 'Do Change Speed' }
] as const

export function WaypointEditor(): React.JSX.Element | null {
  const selectedSeq = useMissionStore((s) => s.selectedWaypointSeq)
  const waypoints = useMissionStore((s) => s.editableWaypoints)
  const updateAlt = useMissionStore((s) => s.updateWaypointAlt)
  const updateAltMode = useMissionStore((s) => s.updateWaypointAltMode)
  const updateCommand = useMissionStore((s) => s.updateWaypointCommand)
  const removeWaypoint = useMissionStore((s) => s.removeWaypoint)

  if (selectedSeq == null) return null

  const wp = waypoints.find((w) => w.seq === selectedSeq)
  if (!wp) return null

  return (
    <div className={styles.root}>
      <div className={styles.title}>Edit WP {wp.seq}</div>

      <div>
        <div className={styles.label}>Command</div>
        <select
          value={wp.command}
          onChange={(e) => {
            const cmd = Number(e.target.value)
            const entry = WAYPOINT_COMMANDS.find((c) => c.value === cmd)
            updateCommand(wp.seq, cmd, entry?.name ?? `CMD ${cmd}`)
          }}
          className="input"
          style={{ cursor: 'pointer' }}
          data-testid="wp-command-select"
        >
          {WAYPOINT_COMMANDS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

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
