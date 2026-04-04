import { useCallback } from 'react'
import { useCameraStore } from '../store/cameraStore'
import { useVehicleStore } from '../store/vehicleStore'
import { CameraMode } from '../../../shared-types/ipc/CameraTypes'
import styles from './CameraPanel.module.css'

function formatRecTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function formatMib(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`
  return `${Math.round(mib)} MB`
}

export function CameraPanel(): React.JSX.Element | null {
  const vehicleId = useVehicleStore((s) => s.activeVehicleId)
  const camera = useCameraStore((s) => (vehicleId ? s.cameras[vehicleId] : undefined))

  const takePhoto = useCallback(() => {
    if (vehicleId) window.bridge?.cameraTakePhoto(vehicleId)
  }, [vehicleId])

  const stopCapture = useCallback(() => {
    if (vehicleId) window.bridge?.cameraStopCapture(vehicleId)
  }, [vehicleId])

  const startRecording = useCallback(() => {
    if (vehicleId) window.bridge?.cameraStartRecording(vehicleId)
  }, [vehicleId])

  const stopRecording = useCallback(() => {
    if (vehicleId) window.bridge?.cameraStopRecording(vehicleId)
  }, [vehicleId])

  const setPhotoMode = useCallback(() => {
    if (vehicleId) window.bridge?.cameraSetMode(vehicleId, CameraMode.Photo)
  }, [vehicleId])

  const setVideoMode = useCallback(() => {
    if (vehicleId) window.bridge?.cameraSetMode(vehicleId, CameraMode.Video)
  }, [vehicleId])

  if (!camera || !camera.discovered) return null

  const isPhoto = camera.mode === CameraMode.Photo
  const isVideo = camera.mode === CameraMode.Video
  const cameraName = camera.info?.modelName || camera.info?.vendorName || 'Camera'

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.cameraName}>{cameraName}</span>
        {camera.storage && (
          <span className={styles.storage}>
            {formatMib(camera.storage.availableCapacityMib)} free
          </span>
        )}
      </div>

      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button
          className={`${styles.modeBtn} ${isPhoto ? styles.modeActive : ''}`}
          onClick={setPhotoMode}
        >
          Photo
        </button>
        <button
          className={`${styles.modeBtn} ${isVideo ? styles.modeActive : ''}`}
          onClick={setVideoMode}
        >
          Video
        </button>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {isPhoto && (
          <>
            <button
              className={styles.captureBtn}
              onClick={camera.isCapturingImage ? stopCapture : takePhoto}
            >
              {camera.isCapturingImage ? 'Stop' : 'Capture'}
            </button>
            <span className={styles.photoCount}>{camera.photoCount} photos</span>
          </>
        )}

        {isVideo && (
          <>
            <button
              className={`${styles.captureBtn} ${camera.isRecordingVideo ? styles.recording : ''}`}
              onClick={camera.isRecordingVideo ? stopRecording : startRecording}
            >
              {camera.isRecordingVideo ? 'Stop' : 'Record'}
            </button>
            {camera.isRecordingVideo && camera.captureStatus && (
              <span className={styles.recTime}>
                {formatRecTime(camera.captureStatus.videoRecordingTimeMs)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
