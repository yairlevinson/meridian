import { useState } from 'react'
import { HoldButton } from '../components/HoldButton'
import { useCommand } from '../hooks/useCommand'
import { useMission } from '../hooks/useMission'
import { useTelemetry } from '../hooks/useVehicle'
import { useMissionStore } from '../store/missionStore'
import styles from './GuidedActions.module.css'

export function GuidedActions(): React.JSX.Element {
  const { guidedTakeoff, guidedRTL, guidedLand, guidedPause, setFlightMode, emergencyStop } =
    useCommand()
  const { uploadMission } = useMission()
  const core = useTelemetry('core')
  const armed = core?.armed ?? false
  const flying = armed && core?.systemStatus === 4 // MAV_STATE_ACTIVE
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

  if (!armed) {
    return (
      <div className={styles.root}>
        <div className={styles.group}>
          <button
            className={styles.btn}
            style={{ color: '#4a9eff', borderColor: '#4a9eff' }}
            onClick={() => guidedTakeoff(10)}
          >
            Takeoff
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {/* Navigation */}
      <div className={styles.group}>
        {!isAuto && (
          <button
            className={styles.btn}
            style={{ color: '#44cc44', borderColor: '#44cc44' }}
            onClick={startMission}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Mission'}
          </button>
        )}
        <button
          className={styles.btn}
          style={{ color: '#aaaaaa', borderColor: '#aaaaaa' }}
          onClick={() => guidedPause()}
        >
          Pause
        </button>
      </div>

      {/* Emergency */}
      <div className={styles.group}>
        <button
          className={styles.btnEmergency}
          style={{ color: '#ffaa00', borderColor: '#ffaa00' }}
          onClick={() => guidedRTL()}
        >
          RTL
        </button>
        <button
          className={styles.btnEmergency}
          style={{ color: '#ff5252', borderColor: '#ff5252' }}
          onClick={() => guidedLand()}
        >
          Land
        </button>
      </div>

      {flying && (
        <div className={styles.group}>
          <HoldButton
            className={styles.btnEmergency}
            style={{ color: '#ff0000', borderColor: '#ff0000' }}
            onConfirm={() => emergencyStop()}
          >
            Emergency Stop
          </HoldButton>
        </div>
      )}
    </div>
  )
}
