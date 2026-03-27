import { useMissionStore } from '../store/missionStore'
import styles from './MissionStatsPanel.module.css'

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${meters.toFixed(0)} m`
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function MissionStatsPanel(): React.JSX.Element {
  const stats = useMissionStore((s) => s.missionStats)

  return (
    <div className={styles.root}>
      <div className={styles.title}>STATS</div>
      <div className={styles.row}>
        <span className={styles.label}>Distance</span>
        <span className={styles.value} data-testid="stats-distance">
          {formatDistance(stats.totalDistanceM)}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Est. Time</span>
        <span className={styles.value} data-testid="stats-time">
          {formatTime(stats.estimatedTimeSec)}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Waypoints</span>
        <span className={styles.value} data-testid="stats-count">
          {stats.waypointCount}
        </span>
      </div>
    </div>
  )
}
