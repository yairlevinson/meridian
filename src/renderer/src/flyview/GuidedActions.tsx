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
  const modeName = core?.flightModeName ?? ''
  const isAutoMission = modeName === 'Auto:Mission' || modeName === 'Auto'
  const waypointCount = useMissionStore((s) => s.editableWaypoints.length)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMission = async (): Promise<void> => {
    setUploading(true)
    setError(null)
    try {
      // Upload waypoints from store if any exist
      if (waypointCount > 0) {
        const result = await uploadMission()
        if (result && typeof result === 'object' && 'error' in result) {
          setError('Mission upload failed')
          return
        }
      }
      const modeResult = await setFlightMode('Mission')
      if (modeResult !== undefined && modeResult !== 0) {
        setError('Failed to set Mission mode')
      }
    } catch {
      setError('Failed to start mission')
    } finally {
      setUploading(false)
    }
  }

  const doTakeoff = async (): Promise<void> => {
    setError(null)
    try {
      const result = await guidedTakeoff(10)
      if (result !== undefined && result !== 0) {
        setError('Takeoff failed')
      }
    } catch {
      setError('Takeoff failed')
    }
  }

  if (!armed) {
    return (
      <div className={styles.root}>
        {error && (
          <div className={styles.error} onClick={() => setError(null)}>
            {error}
          </div>
        )}
        <div className={styles.group}>
          <HoldButton
            className={styles.btn}
            style={{ color: '#4a9eff', borderColor: '#4a9eff' }}
            onConfirm={doTakeoff}
          >
            Takeoff
          </HoldButton>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {error && (
        <div className={styles.error} onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {/* Navigation */}
      <div className={styles.group}>
        {!isAutoMission && (
          <HoldButton
            className={styles.btn}
            style={{ color: '#44cc44', borderColor: '#44cc44' }}
            onConfirm={startMission}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Mission'}
          </HoldButton>
        )}
        <HoldButton
          className={styles.btn}
          style={{ color: '#aaaaaa', borderColor: '#aaaaaa' }}
          onConfirm={() => guidedPause()}
        >
          Pause
        </HoldButton>
      </div>

      {/* Emergency */}
      <div className={styles.group}>
        <HoldButton
          className={styles.btnEmergency}
          style={{ color: '#ffaa00', borderColor: '#ffaa00' }}
          onConfirm={() => guidedRTL()}
        >
          RTL
        </HoldButton>
        <HoldButton
          className={styles.btnEmergency}
          style={{ color: '#ff5252', borderColor: '#ff5252' }}
          onConfirm={() => guidedLand()}
        >
          Land
        </HoldButton>
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
