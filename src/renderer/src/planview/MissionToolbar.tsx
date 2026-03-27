import { useMission } from '../hooks/useMission'
import { useMissionStore } from '../store/missionStore'
import styles from './MissionToolbar.module.css'

export function MissionToolbar(): React.JSX.Element {
  const { uploadMission, downloadMission, savePlan, openPlan } = useMission()
  const protocolState = useMissionStore((s) => s.protocolState)
  const isDirty = useMissionStore((s) => s.isDirty)
  const clearMission = useMissionStore((s) => s.clearMission)

  return (
    <div className={styles.root}>
      <button className="btn" onClick={() => void uploadMission()}>
        Upload
      </button>
      <button className="btn" onClick={() => void downloadMission()}>
        Download
      </button>
      <button className="btn" onClick={() => void savePlan()}>
        Save{isDirty ? '*' : ''}
      </button>
      <button className="btn" onClick={() => void openPlan()}>
        Open
      </button>
      <button className="btn btn-danger" onClick={clearMission}>
        Clear
      </button>
      {protocolState !== 'idle' && (
        <span className={styles.status} data-testid="protocol-state">
          {protocolState}
        </span>
      )}
    </div>
  )
}
