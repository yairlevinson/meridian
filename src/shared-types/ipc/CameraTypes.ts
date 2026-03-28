/**
 * MAVLink Camera Protocol types.
 * Covers camera discovery, photo/video control, and capture status.
 */

// ── Camera mode (from CAMERA_MODE enum) ─────────────────────────
export enum CameraMode {
  Photo = 0,
  Video = 1,
  PhotoSurvey = 2
}

// ── Camera capture status ───────────────────────────────────────
export enum CameraCaptureStatus {
  Idle = 0,
  RunningImageCapture = 1,
  RunningVideoCapture = 2,
  RunningIntervalCapture = 3
}

// ── Storage status ──────────────────────────────────────────────
export enum StorageStatus {
  Empty = 0,
  Unformatted = 1,
  Ready = 2,
  NotSupported = 3
}

// ── Camera information (from CAMERA_INFORMATION msg 259) ────────
export interface CameraInfo {
  vendorName: string
  modelName: string
  firmwareVersion: number
  focalLength: number // mm
  sensorSizeH: number // mm
  sensorSizeV: number // mm
  resolutionH: number // pixels
  resolutionV: number // pixels
  flags: number // CAMERA_CAP_FLAGS bitmask
}

// ── Camera capability flags (CAMERA_CAP_FLAGS) ──────────────────
export const CameraCapFlags = {
  CaptureVideo: 1,
  CaptureImage: 2,
  HasModes: 4,
  CanCaptureImageInVideoMode: 8,
  CanCaptureVideoInImageMode: 16,
  HasImageSurveyMode: 32,
  HasBasicZoom: 64,
  HasBasicFocus: 128,
  HasVideoStream: 256
} as const

// ── Storage information (from STORAGE_INFORMATION msg 261) ──────
export interface StorageInfo {
  storageId: number
  storageCount: number
  status: StorageStatus
  totalCapacityMib: number
  usedCapacityMib: number
  availableCapacityMib: number
}

// ── Capture status (from CAMERA_CAPTURE_STATUS msg 262) ─────────
export interface CaptureStatus {
  imageStatus: CameraCaptureStatus
  videoStatus: CameraCaptureStatus
  imageInterval: number // seconds (0 = single capture)
  imageCount: number
  videoRecordingTimeMs: number
  availableCapacityMib: number
}

// ── Aggregate camera state pushed to renderer ───────────────────
export interface CameraState {
  discovered: boolean
  info: CameraInfo | null
  mode: CameraMode
  captureStatus: CaptureStatus | null
  storage: StorageInfo | null
  photoCount: number
  isRecordingVideo: boolean
  isCapturingImage: boolean
  lastImageLat: number
  lastImageLon: number
  lastImageAlt: number
}
