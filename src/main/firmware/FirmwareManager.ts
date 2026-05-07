import { EventEmitter } from 'events'
import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { FTPManager } from '../ftp/FTPManager'
import type { MavCommandQueue } from '../vehicle/MavCommandQueue'
import { FirmwareUpgradeStatus, type FirmwareUpgradeState } from '@shared/ipc/SetupTypes'

// Remote path on the vehicle's SD card for firmware files
const FIRMWARE_REMOTE_PATH = '/fs/microsd/firmware.bin'

// MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN
const MAV_CMD_PREFLIGHT_REBOOT = 246

/**
 * Manages firmware upload to a vehicle via MAVLink FTP.
 *
 * Flow:
 *  1. User selects a local firmware file (.apj, .px4, .bin)
 *  2. File is read and uploaded to the vehicle via FTP
 *  3. Optionally sends a reboot command to apply
 *
 * Emits 'stateChanged' with FirmwareUpgradeState on each transition.
 */
export class FirmwareManager extends EventEmitter {
  private _state: FirmwareUpgradeState = {
    status: FirmwareUpgradeStatus.Idle,
    progress: 0,
    message: 'Ready'
  }
  private _ftpManager: FTPManager | null = null
  private _commandQueue: MavCommandQueue | null = null
  private _sysid = 0
  private _cancelled = false
  private _progressUnsub: (() => void) | null = null

  get state(): FirmwareUpgradeState {
    return this._state
  }

  setFtpManager(ftp: FTPManager): void {
    this._ftpManager = ftp
  }

  setCommandQueue(queue: MavCommandQueue): void {
    this._commandQueue = queue
  }

  setSysId(sysid: number): void {
    this._sysid = sysid
  }

  /** Upload a firmware file from the local filesystem to the vehicle */
  async uploadFile(filePath: string): Promise<void> {
    if (!this._ftpManager) {
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: 'No FTP connection to vehicle'
      })
      return
    }

    this._cancelled = false

    try {
      const fileStat = await stat(filePath)
      const fileName = basename(filePath)
      const fileSize = fileStat.size

      if (fileSize === 0) {
        this._setState({
          status: FirmwareUpgradeStatus.Failed,
          progress: 0,
          message: 'Firmware file is empty'
        })
        return
      }

      this._setState({
        status: FirmwareUpgradeStatus.Uploading,
        progress: 0,
        message: `Reading ${fileName}...`,
        fileName,
        fileSize
      })

      const content = await readFile(filePath)

      if (this._cancelled) {
        this._setState({
          status: FirmwareUpgradeStatus.Idle,
          progress: 0,
          message: 'Cancelled'
        })
        return
      }

      await this.uploadData(fileName, content, fileSize)
    } catch (err) {
      this._progressUnsub?.()
      this._progressUnsub = null
      const msg = err instanceof Error ? err.message : String(err)
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: `Upload failed: ${msg}`
      })
    }
  }

  /** Upload firmware bytes that were provided by a browser client. */
  async uploadData(
    fileName: string,
    content: Uint8Array,
    fileSize = content.byteLength
  ): Promise<void> {
    if (!this._ftpManager) {
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: 'No FTP connection to vehicle'
      })
      return
    }

    this._cancelled = false

    try {
      if (fileSize === 0) {
        this._setState({
          status: FirmwareUpgradeStatus.Failed,
          progress: 0,
          message: 'Firmware file is empty'
        })
        return
      }

      this._setState({
        status: FirmwareUpgradeStatus.Uploading,
        progress: 0,
        message: `Reading ${fileName}...`,
        fileName,
        fileSize
      })

      if (this._cancelled) {
        this._setState({
          status: FirmwareUpgradeStatus.Idle,
          progress: 0,
          message: 'Cancelled'
        })
        return
      }

      const onProgress = (p: { bytesSent?: number; totalBytes?: number }): void => {
        if (p.bytesSent != null && p.totalBytes != null && p.totalBytes > 0) {
          const progress = p.bytesSent / p.totalBytes
          this._setState({
            status: FirmwareUpgradeStatus.Uploading,
            progress,
            message: `Uploading ${fileName}... ${Math.round(progress * 100)}%`,
            fileName,
            fileSize
          })
        }
      }
      this._ftpManager.on('progress', onProgress)
      this._progressUnsub = () => this._ftpManager?.removeListener('progress', onProgress)

      this._setState({
        status: FirmwareUpgradeStatus.Uploading,
        progress: 0,
        message: `Uploading ${fileName} (${formatBytes(fileSize)})...`,
        fileName,
        fileSize
      })

      // Upload via FTP
      await this._ftpManager.upload(FIRMWARE_REMOTE_PATH, Buffer.from(content))

      this._progressUnsub?.()
      this._progressUnsub = null

      if (this._cancelled) {
        this._setState({
          status: FirmwareUpgradeStatus.Idle,
          progress: 0,
          message: 'Cancelled'
        })
        return
      }

      this._setState({
        status: FirmwareUpgradeStatus.Complete,
        progress: 1,
        message: `${fileName} uploaded successfully. Reboot to apply.`,
        fileName,
        fileSize
      })
    } catch (err) {
      this._progressUnsub?.()
      this._progressUnsub = null
      const msg = err instanceof Error ? err.message : String(err)
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: `Upload failed: ${msg}`
      })
    }
  }

  /** Send reboot command to apply firmware */
  async reboot(): Promise<void> {
    if (!this._commandQueue) {
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: 'No command link to vehicle'
      })
      return
    }

    this._setState({
      status: FirmwareUpgradeStatus.Rebooting,
      progress: 1,
      message: 'Sending reboot command...'
    })

    try {
      await this._commandQueue.sendCommand(
        MAV_CMD_PREFLIGHT_REBOOT,
        this._sysid,
        0,
        { p1: 1 } // 1 = reboot autopilot
      )
      this._setState({
        status: FirmwareUpgradeStatus.Rebooting,
        progress: 1,
        message: 'Reboot command sent. Vehicle will restart with new firmware.'
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._setState({
        status: FirmwareUpgradeStatus.Failed,
        progress: 0,
        message: `Reboot failed: ${msg}`
      })
    }
  }

  /** Cancel an in-progress upload */
  cancel(): void {
    this._cancelled = true
    this._progressUnsub?.()
    this._progressUnsub = null
    this._setState({
      status: FirmwareUpgradeStatus.Idle,
      progress: 0,
      message: 'Cancelled'
    })
  }

  destroy(): void {
    this._cancelled = true
    this._progressUnsub?.()
    this._progressUnsub = null
    this.removeAllListeners()
  }

  private _setState(state: FirmwareUpgradeState): void {
    this._state = state
    this.emit('stateChanged', state)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
