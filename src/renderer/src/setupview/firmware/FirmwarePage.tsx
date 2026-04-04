import { useState, useCallback } from 'react'
import { useVehicleStore } from '../../store/vehicleStore'
import { useSetupStore } from '../../store/setupStore'
import { FirmwareUpgradeStatus } from '../../../../shared-types/ipc/SetupTypes'
import styles from './FirmwarePage.module.css'

const ALLOWED_EXTENSIONS = ['.apj', '.px4', '.bin']

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusBadgeClass(status: FirmwareUpgradeStatus): string {
  switch (status) {
    case FirmwareUpgradeStatus.Uploading:
      return styles.statusUploading!
    case FirmwareUpgradeStatus.Complete:
      return styles.statusComplete!
    case FirmwareUpgradeStatus.Failed:
      return styles.statusFailed!
    case FirmwareUpgradeStatus.Rebooting:
      return styles.statusRebooting!
    default:
      return styles.statusIdle!
  }
}

export function FirmwarePage(): React.JSX.Element {
  const activeVehicleId = useVehicleStore((s) => s.activeVehicleId)
  const vehicle = useVehicleStore((s) => {
    const vid = s.activeVehicleId
    return vid !== null ? s.vehicles[vid] : undefined
  })
  const firmwareState = useSetupStore((s) => s.firmwareUpgradeState)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const core = vehicle?.core

  const handleBrowse = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ALLOWED_EXTENSIONS.join(',')
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) {
        // Use webkitRelativePath or name — the main process will receive the path via IPC
        setSelectedFile(file.name)
        // Store the file path for upload. In Electron, file inputs provide the real path.
        ;(input as unknown as { _filePath: string })._filePath = (
          file as unknown as { path: string }
        ).path
        setSelectedFile((file as unknown as { path: string }).path || file.name)
      }
    }
    input.click()
  }, [])

  const handleUpload = useCallback(() => {
    if (!selectedFile || activeVehicleId === null) return
    window.bridge?.firmwareUploadFile(activeVehicleId, selectedFile)
  }, [selectedFile, activeVehicleId])

  const handleCancel = useCallback(() => {
    if (activeVehicleId === null) return
    window.bridge?.firmwareCancel(activeVehicleId)
  }, [activeVehicleId])

  const handleReboot = useCallback(() => {
    if (activeVehicleId === null) return
    window.bridge?.firmwareReboot(activeVehicleId)
  }, [activeVehicleId])

  if (activeVehicleId === null) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Firmware Upgrade</div>
        <div className={styles.noVehicle}>No vehicle connected</div>
      </div>
    )
  }

  const status = firmwareState?.status ?? FirmwareUpgradeStatus.Idle
  const isUploading = status === FirmwareUpgradeStatus.Uploading
  const isRebooting = status === FirmwareUpgradeStatus.Rebooting
  const isComplete = status === FirmwareUpgradeStatus.Complete
  const isFailed = status === FirmwareUpgradeStatus.Failed
  const isBusy = isUploading || isRebooting
  const progress = firmwareState?.progress ?? 0

  return (
    <div className={styles.root}>
      <div className={styles.title}>Firmware Upgrade</div>

      {/* Current firmware info */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Current Firmware</div>
        <div className={styles.infoGrid}>
          <span className={styles.infoLabel}>Version</span>
          <span className={styles.infoValue}>
            {core
              ? `${core.firmwareVersionMajor}.${core.firmwareVersionMinor}.${core.firmwareVersionPatch}`
              : 'Unknown'}
          </span>
          <span className={styles.infoLabel}>Vehicle Type</span>
          <span className={styles.infoValue}>{core?.vehicleType ?? '-'}</span>
          <span className={styles.infoLabel}>Autopilot</span>
          <span className={styles.infoValue}>{core?.autopilot ?? '-'}</span>
          <span className={styles.infoLabel}>System ID</span>
          <span className={styles.infoValue}>{core?.sysid ?? '-'}</span>
        </div>
      </div>

      {/* Warning */}
      <div className={styles.section}>
        <div className={styles.warning}>
          Uploading firmware will overwrite the current firmware on the vehicle. Ensure you have the
          correct firmware file for your board. Do not disconnect during upload.
        </div>
      </div>

      {/* File selection & upload */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Upload Firmware</div>
        <div className={styles.uploadArea}>
          <div className={styles.fileSelect}>
            <button className={styles.browseBtn} onClick={handleBrowse} disabled={isBusy}>
              Browse...
            </button>
            <span className={styles.fileName}>
              {selectedFile ? selectedFile.split('/').pop() : 'No file selected'}
            </span>
          </div>

          {/* Progress bar */}
          {(isUploading || isComplete || isFailed || isRebooting) && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBar}>
                <div
                  className={`${styles.progressFill} ${isFailed ? styles.progressFillError : ''}`}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className={styles.progressMsg}>{firmwareState?.message ?? ''}</span>
            </div>
          )}

          {/* Status badge */}
          {status !== FirmwareUpgradeStatus.Idle && (
            <span className={`${styles.statusBadge} ${statusBadgeClass(status)}`}>{status}</span>
          )}

          {/* Action buttons */}
          <div className={styles.actions}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleUpload}
              disabled={!selectedFile || isBusy}
            >
              Upload
            </button>
            {isUploading && (
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleCancel}>
                Cancel
              </button>
            )}
            {isComplete && (
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleReboot}>
                Reboot Vehicle
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
