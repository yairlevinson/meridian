import { useState } from 'react'
import { useCommand } from '../hooks/useCommand'
import { useMission } from '../hooks/useMission'
import { useTelemetry } from '../hooks/useVehicle'
import { useMissionStore } from '../store/missionStore'
import styles from './GuidedActions.module.css'

export function GuidedActions(): React.JSX.Element {
  const { guidedTakeoff, guidedRTL, guidedLand, guidedPause, setFlightMode } = useCommand()
  const { uploadMission } = useMission()
  const core = useTelemetry('core')
  const armed = core?.armed ?? false
  const isAuto = core?.flightMode === 3
  const waypointCount = useMissionStore((s) => s.editableWaypoints.length)
  const [uploading, setUploading] = useState(false)

  const startMission = async (): Promise<void> => {
    setUploading(true)
    try {
      // Upload waypoints from store if any exist
      if (waypointCount > 0) {
        const result = await uploadMission()
        if (result && typeof result === 'object' && 'error' in result) {
          console.warn(
            '[GuidedActions] Mission upload failed:',
            (result as { error: unknown }).error
          )
          return
        }
      }
      await setFlightMode('3')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={styles.root}>
      {!armed && (
        <button
          className={styles.btn}
          style={{ color: '#4a9eff', borderColor: '#4a9eff' }}
          onClick={() => guidedTakeoff(10)}
        >
          Takeoff
        </button>
      )}
      {armed && (
        <>
          {!isAuto && (
            <button
              className={styles.btn}
              style={{ color: '#44cc44', borderColor: '#44cc44' }}
              onClick={startMission}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Mission'}
            </button>
          )}
          <button
            className={styles.btn}
            style={{ color: '#ffaa00', borderColor: '#ffaa00' }}
            onClick={() => guidedRTL()}
          >
            RTL
          </button>
          <button
            className={styles.btn}
            style={{ color: '#ff6644', borderColor: '#ff6644' }}
            onClick={() => guidedLand()}
          >
            Land
          </button>
          <button
            className={styles.btn}
            style={{ color: '#aaaaaa', borderColor: '#aaaaaa' }}
            onClick={() => guidedPause()}
          >
            Pause
          </button>
        </>
      )}
    </div>
  )
}
