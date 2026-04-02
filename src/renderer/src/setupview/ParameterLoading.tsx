import { useParameterStore } from '../store/parameterStore'
import { useVehicleStore } from '../store/vehicleStore'
import styles from './ParameterLoading.module.css'

export function ParameterLoading(): React.JSX.Element {
  const loadState = useParameterStore((s) => s.loadState)
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)

  const hasVehicle = activeVehicleId != null
  const { receivedCount, totalCount, loadProgress } = loadState
  const showProgress = hasVehicle && totalCount > 0

  const handleRetry = (): void => {
    window.bridge?.refreshParameters?.(activeVehicleId ?? 1)
  }

  return (
    <div className={styles.container}>
      <div className={styles.spinner} />
      <div className={styles.message}>
        {hasVehicle ? 'Loading parameters...' : 'Waiting for vehicle connection...'}
      </div>
      {showProgress && (
        <>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${loadProgress * 100}%` }} />
          </div>
          <div className={styles.progressText}>
            {receivedCount} / {totalCount} parameters
          </div>
        </>
      )}
      {hasVehicle && (
        <button className={styles.retryBtn} onClick={handleRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
