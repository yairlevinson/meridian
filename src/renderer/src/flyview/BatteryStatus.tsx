import { useTelemetry } from '../hooks/useVehicle'
import styles from './BatteryStatus.module.css'

export function BatteryStatus(): React.JSX.Element {
  const battery = useTelemetry('battery')

  if (!battery || battery.batteries.length === 0) {
    return <div className="no-data">No battery data</div>
  }

  return (
    <div className={styles.root}>
      {battery.batteries.map((bat) => (
        <BatteryWidget
          key={bat.id}
          id={bat.id}
          voltage={bat.voltage}
          current={bat.current}
          remaining={bat.remaining}
        />
      ))}
    </div>
  )
}

function BatteryWidget({
  id,
  voltage,
  current,
  remaining
}: {
  id: number
  voltage: number
  current: number
  remaining: number
}): React.JSX.Element {
  const color = remaining > 30 ? '#00ff88' : remaining > 15 ? '#ffaa00' : '#ff4444'

  return (
    <div className={styles.widget}>
      <div className={styles.row}>
        <span className={styles.label}>BAT{id}</span>
        <span style={{ color }}>{remaining}%</span>
      </div>
      <div className={styles.row}>
        <span className={styles.detail}>{voltage.toFixed(1)}V</span>
        <span className={styles.detail}>{current.toFixed(1)}A</span>
      </div>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ background: color, width: `${remaining}%` }} />
      </div>
    </div>
  )
}
