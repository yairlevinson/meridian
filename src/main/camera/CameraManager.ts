import { common } from 'mavlink-mappings'
import type { LinkInterface } from '../links/LinkInterface'
import { createGcsProtocol } from '../mavlink/constants'
import { VehicleSubsystem } from '../vehicle/VehicleContext'
import type { CameraInfo, CameraState, CaptureStatus, StorageInfo } from '@shared/ipc/CameraTypes'
import {
  CameraMode,
  CameraCapFlags,
  CameraCaptureStatus,
  StorageStatus
} from '@shared/ipc/CameraTypes'

// MAV_CMD constants for camera protocol
const MAV_CMD_REQUEST_MESSAGE = 512
const MAV_CMD_REQUEST_CAMERA_INFORMATION = 521
const MAV_CMD_REQUEST_CAMERA_SETTINGS = 522
const MAV_CMD_REQUEST_STORAGE_INFORMATION = 525
const MAV_CMD_REQUEST_CAMERA_CAPTURE_STATUS = 527
const MAV_CMD_RESET_CAMERA_SETTINGS = 529
const MAV_CMD_SET_CAMERA_MODE = 530
const MAV_CMD_IMAGE_START_CAPTURE = 2000
const MAV_CMD_IMAGE_STOP_CAPTURE = 2001
const MAV_CMD_VIDEO_START_CAPTURE = 2500
const MAV_CMD_VIDEO_STOP_CAPTURE = 2501
const MAV_CMD_STORAGE_FORMAT = 42501

// MAVLink message IDs for camera responses
const MSG_CAMERA_INFORMATION = 259
const MSG_CAMERA_SETTINGS = 260
const MSG_STORAGE_INFORMATION = 261
const MSG_CAMERA_CAPTURE_STATUS = 262
// Polling intervals (matching QGC)
const INFO_REQUEST_INTERVAL_MS = 2000
const INFO_MAX_RETRIES = 10
const SETTINGS_REQUEST_INTERVAL_MS = 1000
const SETTINGS_MAX_RETRIES = 5
const CAPTURE_STATUS_POLL_MS = 1500
const CAPTURE_STATUS_ACTIVE_POLL_MS = 1000
const CAPTURE_STATUS_VIDEO_POLL_MS = 5000
const STORAGE_REQUEST_INTERVAL_MS = 2000
const STORAGE_MAX_RETRIES = 5

/**
 * Manages a MAVLink camera component on a vehicle.
 *
 * Protocol flow (per QGC reference):
 * 1. On first heartbeat from camera component, request CAMERA_INFORMATION
 * 2. On receiving info, request CAMERA_SETTINGS and STORAGE_INFORMATION
 * 3. Poll CAMERA_CAPTURE_STATUS periodically
 * 4. Send commands for photo/video/mode changes
 */
export class CameraManager extends VehicleSubsystem {
  private protocol = createGcsProtocol()
  private seq = 0
  private link: LinkInterface | null = null
  private targetSystem = 1
  private targetComponent = 100 // MAV_COMP_ID_CAMERA

  // Camera state
  private _info: CameraInfo | null = null
  private _mode: CameraMode = CameraMode.Photo
  private _captureStatus: CaptureStatus | null = null
  private _storage: StorageInfo | null = null
  private _photoCount = 0
  private _isRecordingVideo = false
  private _isCapturingImage = false
  private _discovered = false

  // Request retry tracking
  private _infoRetries = 0
  private _settingsRetries = 0
  private _storageRetries = 0
  private _infoTimer: ReturnType<typeof setTimeout> | null = null
  private _settingsTimer: ReturnType<typeof setTimeout> | null = null
  private _storageTimer: ReturnType<typeof setTimeout> | null = null
  private _captureStatusTimer: ReturnType<typeof setInterval> | null = null
  private _storageDelayTimer: ReturnType<typeof setTimeout> | null = null
  // Alternating request method flag (QGC pattern: alternate between
  // MAV_CMD_REQUEST_MESSAGE and legacy-specific commands)
  private _useRequestMessage = true

  protected override onBind(): void {
    // Camera's targetComponent stays at MAV_COMP_ID_CAMERA (100) — ctx.compid
    // is the autopilot (1), which is the wrong target for camera commands.
    this.link = this.ctx!.link
    this.targetSystem = this.ctx!.sysid
  }

  /** Called when a heartbeat from a camera component is received */
  handleCameraHeartbeat(): void {
    if (!this._discovered && !this._infoTimer) {
      this._requestCameraInformation()
    }
  }

  /** Handle CAMERA_INFORMATION (259) */
  handleCameraInformation(data: Record<string, unknown>): void {
    this._clearTimer('info')
    const flags = (data['flags'] as number) ?? 0
    const vendorBytes = data['vendorName'] as number[] | undefined
    const modelBytes = data['modelName'] as number[] | undefined

    this._info = {
      vendorName: vendorBytes ? this._bytesToString(vendorBytes) : '',
      modelName: modelBytes ? this._bytesToString(modelBytes) : '',
      firmwareVersion: (data['firmwareVersion'] as number) ?? 0,
      focalLength: (data['focalLength'] as number) ?? 0,
      sensorSizeH: (data['sensorSizeH'] as number) ?? 0,
      sensorSizeV: (data['sensorSizeV'] as number) ?? 0,
      resolutionH: (data['resolutionH'] as number) ?? 0,
      resolutionV: (data['resolutionV'] as number) ?? 0,
      flags
    }
    this._discovered = true
    this.emit('stateChanged', this.state)

    // After discovering camera, request settings and storage
    this._requestCameraSettings()
    this._storageDelayTimer = setTimeout(() => {
      this._storageDelayTimer = null
      this._requestStorageInformation()
    }, STORAGE_REQUEST_INTERVAL_MS)
    this._startCaptureStatusPolling()
  }

  /** Handle CAMERA_SETTINGS (260) */
  handleCameraSettings(data: Record<string, number>): void {
    this._clearTimer('settings')
    this._mode = (data['modeId'] ?? 0) as CameraMode
    this.emit('stateChanged', this.state)
  }

  /** Handle STORAGE_INFORMATION (261) */
  handleStorageInformation(data: Record<string, number>): void {
    this._clearTimer('storage')
    this._storage = {
      storageId: data['storageId'] ?? 0,
      storageCount: data['storageCount'] ?? 0,
      status: (data['status'] ?? 0) as StorageStatus,
      totalCapacityMib: data['totalCapacity'] ?? 0,
      usedCapacityMib: data['usedCapacity'] ?? 0,
      availableCapacityMib: data['availableCapacity'] ?? 0
    }
    this.emit('stateChanged', this.state)
  }

  /** Handle CAMERA_CAPTURE_STATUS (262) */
  handleCaptureStatus(data: Record<string, number>): void {
    const imageStatus = data['imageStatus'] ?? 0
    const videoStatus = data['videoStatus'] ?? 0
    this._captureStatus = {
      imageStatus: imageStatus as CameraCaptureStatus,
      videoStatus: videoStatus as CameraCaptureStatus,
      imageInterval: data['imageInterval'] ?? 0,
      imageCount: data['imageCount'] ?? 0,
      videoRecordingTimeMs: data['recordingTimeMs'] ?? 0,
      availableCapacityMib: data['availableCapacity'] ?? 0
    }
    this._isCapturingImage = imageStatus === 1 || imageStatus === 3
    this._isRecordingVideo = videoStatus === 1
    this._photoCount = data['imageCount'] ?? this._photoCount

    // Adjust polling rate based on activity (QGC pattern)
    this._adjustCaptureStatusPolling()
    this.emit('stateChanged', this.state)
  }

  /** Handle CAMERA_IMAGE_CAPTURED (263) */
  handleImageCaptured(data: Record<string, number>): void {
    this._photoCount++
    this._isCapturingImage = false
    this.emit('imageCaptured', {
      lat: (data['lat'] ?? 0) / 1e7,
      lon: (data['lon'] ?? 0) / 1e7,
      alt: (data['alt'] ?? 0) / 1000,
      imageIndex: data['imageIndex'] ?? 0,
      captureResult: data['captureResult'] ?? 0
    })
    this.emit('stateChanged', this.state)
  }

  // ── Commands ──────────────────────────────────────────────────

  /** Take a single photo */
  takePhoto(): void {
    if (!this._hasCapability(CameraCapFlags.CaptureImage)) return
    this._sendCommand(MAV_CMD_IMAGE_START_CAPTURE, {
      p1: 0, // all cameras
      p2: 0, // single shot (no interval)
      p3: 1 // count = 1
    })
    this._isCapturingImage = true
    this.emit('stateChanged', this.state)
  }

  /** Start interval/timelapse capture */
  startIntervalCapture(intervalSec: number, count = 0): void {
    if (!this._hasCapability(CameraCapFlags.CaptureImage)) return
    this._sendCommand(MAV_CMD_IMAGE_START_CAPTURE, {
      p1: 0,
      p2: intervalSec,
      p3: count // 0 = unlimited
    })
    this._isCapturingImage = true
    this.emit('stateChanged', this.state)
  }

  /** Stop photo capture (interval mode) */
  stopCapture(): void {
    this._sendCommand(MAV_CMD_IMAGE_STOP_CAPTURE, { p1: 0 })
    this._isCapturingImage = false
    this.emit('stateChanged', this.state)
  }

  /** Start video recording */
  startRecording(): void {
    if (!this._hasCapability(CameraCapFlags.CaptureVideo)) return
    this._sendCommand(MAV_CMD_VIDEO_START_CAPTURE, {
      p1: 0, // all streams
      p2: 0, // status frequency
      p3: 0 // all cameras
    })
    this._isRecordingVideo = true
    this.emit('stateChanged', this.state)
  }

  /** Stop video recording */
  stopRecording(): void {
    this._sendCommand(MAV_CMD_VIDEO_STOP_CAPTURE, {
      p1: 0, // all streams
      p2: 0 // all cameras
    })
    this._isRecordingVideo = false
    this.emit('stateChanged', this.state)
  }

  /** Switch camera mode (photo / video) */
  setMode(mode: CameraMode): void {
    this._sendCommand(MAV_CMD_SET_CAMERA_MODE, {
      p1: 0, // reserved
      p2: mode // 0=photo, 1=video
    })
    this._mode = mode
    this.emit('stateChanged', this.state)
  }

  /** Format storage card */
  formatStorage(storageId = 1): void {
    this._sendCommand(MAV_CMD_STORAGE_FORMAT, {
      p1: storageId,
      p2: 1 // do format
    })
  }

  /** Reset camera settings to factory defaults */
  resetSettings(): void {
    this._sendCommand(MAV_CMD_RESET_CAMERA_SETTINGS, { p1: 1 })
  }

  /** Aggregate state for the renderer */
  get state(): CameraState {
    return {
      discovered: this._discovered,
      info: this._info,
      mode: this._mode,
      captureStatus: this._captureStatus,
      storage: this._storage,
      photoCount: this._photoCount,
      isRecordingVideo: this._isRecordingVideo,
      isCapturingImage: this._isCapturingImage,
      lastImageLat: 0,
      lastImageLon: 0,
      lastImageAlt: 0
    }
  }

  destroy(): void {
    this._clearTimer('info')
    this._clearTimer('settings')
    this._clearTimer('storage')
    if (this._storageDelayTimer) {
      clearTimeout(this._storageDelayTimer)
      this._storageDelayTimer = null
    }
    if (this._captureStatusTimer) {
      clearInterval(this._captureStatusTimer)
      this._captureStatusTimer = null
    }
    this.removeAllListeners()
  }

  // ── Internal request methods ──────────────────────────────────

  private _requestCameraInformation(): void {
    if (this._infoRetries >= INFO_MAX_RETRIES) return
    this._infoRetries++

    // Alternate between MAV_CMD_REQUEST_MESSAGE and legacy command (QGC pattern)
    if (this._useRequestMessage) {
      this._sendCommand(MAV_CMD_REQUEST_MESSAGE, { p1: MSG_CAMERA_INFORMATION })
    } else {
      this._sendCommand(MAV_CMD_REQUEST_CAMERA_INFORMATION, { p1: 0 })
    }
    this._useRequestMessage = !this._useRequestMessage

    this._infoTimer = setTimeout(() => this._requestCameraInformation(), INFO_REQUEST_INTERVAL_MS)
  }

  private _requestCameraSettings(): void {
    if (this._settingsRetries >= SETTINGS_MAX_RETRIES) return
    this._settingsRetries++

    if (this._useRequestMessage) {
      this._sendCommand(MAV_CMD_REQUEST_MESSAGE, { p1: MSG_CAMERA_SETTINGS })
    } else {
      this._sendCommand(MAV_CMD_REQUEST_CAMERA_SETTINGS, { p1: 0 })
    }

    this._settingsTimer = setTimeout(
      () => this._requestCameraSettings(),
      SETTINGS_REQUEST_INTERVAL_MS
    )
  }

  private _requestStorageInformation(): void {
    if (this._storageRetries >= STORAGE_MAX_RETRIES) return
    this._storageRetries++

    if (this._useRequestMessage) {
      this._sendCommand(MAV_CMD_REQUEST_MESSAGE, { p1: MSG_STORAGE_INFORMATION })
    } else {
      this._sendCommand(MAV_CMD_REQUEST_STORAGE_INFORMATION, { p1: 1 })
    }

    this._storageTimer = setTimeout(
      () => this._requestStorageInformation(),
      STORAGE_REQUEST_INTERVAL_MS
    )
  }

  private _requestCaptureStatus(): void {
    if (this._useRequestMessage) {
      this._sendCommand(MAV_CMD_REQUEST_MESSAGE, { p1: MSG_CAMERA_CAPTURE_STATUS })
    } else {
      this._sendCommand(MAV_CMD_REQUEST_CAMERA_CAPTURE_STATUS, { p1: 0 })
    }
  }

  private _startCaptureStatusPolling(): void {
    if (this._captureStatusTimer) return
    this._captureStatusTimer = setInterval(
      () => this._requestCaptureStatus(),
      CAPTURE_STATUS_POLL_MS
    )
  }

  private _adjustCaptureStatusPolling(): void {
    if (!this._captureStatusTimer) return
    clearInterval(this._captureStatusTimer)

    let interval = CAPTURE_STATUS_POLL_MS
    if (this._isCapturingImage) {
      interval = CAPTURE_STATUS_ACTIVE_POLL_MS
    } else if (this._isRecordingVideo) {
      interval = CAPTURE_STATUS_VIDEO_POLL_MS
    }

    this._captureStatusTimer = setInterval(() => this._requestCaptureStatus(), interval)
  }

  // ── Helpers ───────────────────────────────────────────────────

  private _sendCommand(
    command: number,
    params: {
      p1?: number
      p2?: number
      p3?: number
      p4?: number
      p5?: number
      p6?: number
      p7?: number
    } = {}
  ): void {
    if (!this.link) return

    const cmd = new common.CommandLong()
    cmd.targetSystem = this.targetSystem
    cmd.targetComponent = this.targetComponent
    cmd.command = command
    cmd.confirmation = 0
    cmd._param1 = params.p1 ?? 0
    cmd._param2 = params.p2 ?? 0
    cmd._param3 = params.p3 ?? 0
    cmd._param4 = params.p4 ?? 0
    cmd._param5 = params.p5 ?? 0
    cmd._param6 = params.p6 ?? 0
    cmd._param7 = params.p7 ?? 0

    this.link.writeBytes(this.protocol.serialize(cmd, this.seq++ & 0xff))
  }

  private _hasCapability(flag: number): boolean {
    if (!this._info) return true // Optimistic if no info yet
    return !!(this._info.flags & flag)
  }

  private _clearTimer(name: 'info' | 'settings' | 'storage'): void {
    const key = `_${name}Timer` as '_infoTimer' | '_settingsTimer' | '_storageTimer'
    if (this[key]) {
      clearTimeout(this[key]!)
      this[key] = null
    }
  }

  private _bytesToString(bytes: number[]): string {
    return String.fromCharCode(...bytes.filter((b) => b !== 0))
  }
}
