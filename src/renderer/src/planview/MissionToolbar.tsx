import { useCallback, useState } from 'react'
import { useMission } from '../hooks/useMission'
import { useMissionStore } from '../store/missionStore'
import { useOverlayStore } from '../store/overlayStore'
import { MissionProtocolState } from '../../../shared-types/ipc/MissionTypes'
import type { KmlImportResult } from '../../../shared-types/ipc/OverlayTypes'
import styles from './MissionToolbar.module.css'

type ToastType = 'success' | 'error'

export function MissionToolbar(): React.JSX.Element {
  const { uploadMission, downloadMission, savePlan, openPlan } = useMission()
  const protocolState = useMissionStore((s) => s.protocolState)
  const isDirty = useMissionStore((s) => s.isDirty)
  const clearMission = useMissionStore((s) => s.clearMission)
  const addOverlayLayer = useOverlayStore((s) => s.addLayer)
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null)

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const busy = protocolState !== MissionProtocolState.Idle

  const handleUpload = useCallback(async () => {
    try {
      await uploadMission()
      showToast('Mission uploaded')
    } catch {
      showToast('Upload failed', 'error')
    }
  }, [uploadMission, showToast])

  const handleDownload = useCallback(async () => {
    try {
      await downloadMission()
      showToast('Mission downloaded')
    } catch {
      showToast('Download failed', 'error')
    }
  }, [downloadMission, showToast])

  const handleImportKml = useCallback(async () => {
    try {
      const result = await window.bridge?.kmlImport()
      if (!result || 'cancelled' in result) return
      const kml = result as KmlImportResult
      addOverlayLayer(kml.fileName, kml.geometries)
      showToast(`Imported ${kml.geometries.length} geometries`)
    } catch {
      showToast('KML import failed', 'error')
    }
  }, [addOverlayLayer, showToast])

  const handleClear = useCallback(() => {
    clearMission()
    showToast('Mission cleared')
  }, [clearMission, showToast])

  return (
    <div className={styles.root}>
      <button className="btn" disabled={busy} onClick={() => void handleUpload()}>
        Upload
      </button>
      <button className="btn" disabled={busy} onClick={() => void handleDownload()}>
        Download
      </button>
      <button className="btn" onClick={() => void savePlan()}>
        Save{isDirty ? '*' : ''}
      </button>
      <button className="btn" onClick={() => void openPlan()}>
        Open
      </button>
      <button className="btn" onClick={() => void handleImportKml()}>
        Import KML
      </button>
      <button className="btn btn-danger" disabled={busy} onClick={handleClear}>
        Clear
      </button>
      {busy && (
        <span className={styles.status} data-testid="protocol-state">
          {protocolState}...
        </span>
      )}
      {toast && (
        <span className={toast.type === 'error' ? styles.toastError : styles.toastSuccess}>
          {toast.msg}
        </span>
      )}
    </div>
  )
}
