import { useTelemetry } from '../hooks/useVehicle'
import styles from './SystemHealthStrip.module.css'

export function SystemHealthStrip(): React.JSX.Element {
  const gpsRaw = useTelemetry('gpsRaw')
  const battery = useTelemetry('battery')
  const sysStatus = useTelemetry('sysStatus')

  const gpsOk = gpsRaw != null && gpsRaw.fixType >= 3
  const batOk = battery && battery.batteries.length > 0 && battery.batteries[0]!.remaining > 20
  const sensorsOk =
    sysStatus != null &&
    (sysStatus.onboardControlSensorsHealth & sysStatus.onboardControlSensorsEnabled) ===
      sysStatus.onboardControlSensorsEnabled

  const bat = battery?.batteries[0]

  return (
    <div className={styles.root}>
      <div className={`${styles.item} ${gpsOk ? styles.ok : styles.warn}`}>
        <span className={styles.icon}>&#x2295;</span>
        <span>{gpsRaw ? `${gpsRaw.satelliteCount} sat` : '---'}</span>
      </div>
      <div className={`${styles.item} ${batOk ? styles.ok : styles.warn}`}>
        <span className={styles.icon}>&#x26A1;</span>
        <span>{bat ? `${bat.remaining}%` : '---'}</span>
      </div>
      <div className={`${styles.item} ${sensorsOk ? styles.ok : styles.warn}`}>
        <span className={styles.icon}>&#x25C8;</span>
        <span>{sensorsOk ? 'OK' : '!'}</span>
      </div>
    </div>
  )
}
