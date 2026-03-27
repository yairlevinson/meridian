import { useVehicleIds, useActiveVehicleId, useSetActiveVehicle } from '../hooks/useVehicle'
import styles from './VehicleSelector.module.css'

export function VehicleSelector(): React.JSX.Element | null {
  const vehicleIds = useVehicleIds()
  const activeVehicleId = useActiveVehicleId()
  const setActiveVehicle = useSetActiveVehicle()

  if (vehicleIds.length === 0) return null

  return (
    <div className={styles.root}>
      {vehicleIds.map((id) => (
        <button
          key={id}
          onClick={() => setActiveVehicle(id)}
          className={`${styles.btn} ${id === activeVehicleId ? styles.btnActive : ''}`}
        >
          V{id}
        </button>
      ))}
    </div>
  )
}
