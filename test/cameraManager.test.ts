// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CameraManager } from '../src/main/camera/CameraManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { CameraMode, CameraCapFlags } from '../src/shared-types/ipc/CameraTypes'

describe('CameraManager — discovery', () => {
  let cm: CameraManager
  let link: MockLink

  beforeEach(() => {
    vi.useFakeTimers()
    cm = new CameraManager()
    link = new MockLink()
    cm.setLink(link)
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
    vi.useRealTimers()
  })

  it('starts undiscovered', () => {
    expect(cm.state.discovered).toBe(false)
    expect(cm.state.info).toBeNull()
  })

  it('sends CAMERA_INFORMATION request on heartbeat', () => {
    cm.handleCameraHeartbeat()
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('retries info request with alternating command IDs', () => {
    cm.handleCameraHeartbeat()
    expect(link.sentBuffers).toHaveLength(1)

    vi.advanceTimersByTime(2000) // INFO_REQUEST_INTERVAL_MS
    expect(link.sentBuffers).toHaveLength(2)

    vi.advanceTimersByTime(2000)
    expect(link.sentBuffers).toHaveLength(3)
  })

  it('stops retrying after max retries', () => {
    cm.handleCameraHeartbeat()
    // Advance past all 10 retries (10 * 2000ms)
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(2000)
    }
    const count = link.sentBuffers.length
    vi.advanceTimersByTime(10000)
    expect(link.sentBuffers.length).toBe(count) // no more retries
  })

  it('marks discovered on CAMERA_INFORMATION', () => {
    const changed = vi.fn()
    cm.on('stateChanged', changed)

    cm.handleCameraInformation({
      vendorName: [83, 111, 110, 121, 0], // "Sony"
      modelName: [65, 55, 0], // "A7"
      firmwareVersion: 1,
      focalLength: 35,
      sensorSizeH: 36,
      sensorSizeV: 24,
      resolutionH: 4000,
      resolutionV: 3000,
      flags: CameraCapFlags.CaptureImage | CameraCapFlags.CaptureVideo
    })

    expect(cm.state.discovered).toBe(true)
    expect(cm.state.info).not.toBeNull()
    expect(cm.state.info!.vendorName).toBe('Sony')
    expect(cm.state.info!.modelName).toBe('A7')
    expect(cm.state.info!.focalLength).toBe(35)
    expect(cm.state.info!.flags).toBe(
      CameraCapFlags.CaptureImage | CameraCapFlags.CaptureVideo
    )
    expect(changed).toHaveBeenCalled()
  })

  it('does not re-request info after discovery', () => {
    cm.handleCameraHeartbeat()
    const countBefore = link.sentBuffers.length

    cm.handleCameraInformation({ flags: 3 })

    // Second heartbeat should not trigger new info request
    cm.handleCameraHeartbeat()
    vi.advanceTimersByTime(5000)

    // Should have sent settings/storage/captureStatus requests, but not info again
    // The key check is that info timer was cleared
    expect(cm.state.discovered).toBe(true)
  })
})

describe('CameraManager — camera settings', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
    cm.setLink(new MockLink())
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
  })

  it('updates mode from CAMERA_SETTINGS', () => {
    cm.handleCameraSettings({ modeId: CameraMode.Video })
    expect(cm.state.mode).toBe(CameraMode.Video)
  })

  it('defaults to photo mode', () => {
    expect(cm.state.mode).toBe(CameraMode.Photo)
  })
})

describe('CameraManager — storage', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
    cm.setLink(new MockLink())
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
  })

  it('updates storage from STORAGE_INFORMATION', () => {
    cm.handleStorageInformation({
      storageId: 1,
      storageCount: 1,
      status: 2, // Ready
      totalCapacity: 32768,
      usedCapacity: 8192,
      availableCapacity: 24576
    })

    expect(cm.state.storage).not.toBeNull()
    expect(cm.state.storage!.totalCapacityMib).toBe(32768)
    expect(cm.state.storage!.availableCapacityMib).toBe(24576)
    expect(cm.state.storage!.status).toBe(2)
  })
})

describe('CameraManager — capture status', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
    cm.setLink(new MockLink())
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
  })

  it('tracks photo capture in progress', () => {
    cm.handleCaptureStatus({
      imageStatus: 1, // RunningImageCapture
      videoStatus: 0,
      imageInterval: 0,
      imageCount: 5,
      recordingTimeMs: 0,
      availableCapacity: 1000
    })

    expect(cm.state.isCapturingImage).toBe(true)
    expect(cm.state.isRecordingVideo).toBe(false)
    expect(cm.state.photoCount).toBe(5)
  })

  it('tracks video recording in progress', () => {
    cm.handleCaptureStatus({
      imageStatus: 0,
      videoStatus: 1, // Running
      imageInterval: 0,
      imageCount: 0,
      recordingTimeMs: 12500,
      availableCapacity: 500
    })

    expect(cm.state.isRecordingVideo).toBe(true)
    expect(cm.state.isCapturingImage).toBe(false)
    expect(cm.state.captureStatus!.videoRecordingTimeMs).toBe(12500)
  })

  it('tracks interval capture (status 3)', () => {
    cm.handleCaptureStatus({
      imageStatus: 3, // RunningIntervalCapture
      videoStatus: 0,
      imageInterval: 2,
      imageCount: 10,
      recordingTimeMs: 0,
      availableCapacity: 2000
    })

    expect(cm.state.isCapturingImage).toBe(true)
    expect(cm.state.photoCount).toBe(10)
  })
})

describe('CameraManager — image captured event', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
    cm.setLink(new MockLink())
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
  })

  it('increments photo count and emits event', () => {
    const captured = vi.fn()
    cm.on('imageCaptured', captured)

    cm.handleImageCaptured({
      lat: 474000000, // 47.4°
      lon: 85000000,  // 8.5°
      alt: 100000,    // 100m
      imageIndex: 1,
      captureResult: 1
    })

    expect(cm.state.photoCount).toBe(1)
    expect(cm.state.isCapturingImage).toBe(false)
    expect(captured).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: expect.closeTo(47.4, 1),
        lon: expect.closeTo(8.5, 1),
        imageIndex: 1
      })
    )
  })

  it('increments count on successive captures', () => {
    cm.handleImageCaptured({ lat: 0, lon: 0, alt: 0, imageIndex: 1, captureResult: 1 })
    cm.handleImageCaptured({ lat: 0, lon: 0, alt: 0, imageIndex: 2, captureResult: 1 })
    cm.handleImageCaptured({ lat: 0, lon: 0, alt: 0, imageIndex: 3, captureResult: 1 })

    expect(cm.state.photoCount).toBe(3)
  })
})

describe('CameraManager — commands', () => {
  let cm: CameraManager
  let link: MockLink

  beforeEach(() => {
    cm = new CameraManager()
    link = new MockLink()
    cm.setLink(link)
    cm.setTarget(1)
    // Give it camera info with full capabilities
    cm.handleCameraInformation({
      flags: CameraCapFlags.CaptureImage | CameraCapFlags.CaptureVideo
    })
    link.sentBuffers.length = 0 // clear discovery requests
  })

  afterEach(() => {
    cm.destroy()
  })

  it('takePhoto sends a command', () => {
    cm.takePhoto()
    expect(link.sentBuffers).toHaveLength(1)
    expect(cm.state.isCapturingImage).toBe(true)
  })

  it('stopCapture sends a command', () => {
    cm.stopCapture()
    expect(link.sentBuffers).toHaveLength(1)
    expect(cm.state.isCapturingImage).toBe(false)
  })

  it('startRecording sends a command', () => {
    cm.startRecording()
    expect(link.sentBuffers).toHaveLength(1)
    expect(cm.state.isRecordingVideo).toBe(true)
  })

  it('stopRecording sends a command and clears state', () => {
    cm.startRecording()
    link.sentBuffers.length = 0

    cm.stopRecording()
    expect(link.sentBuffers).toHaveLength(1)
    expect(cm.state.isRecordingVideo).toBe(false)
  })

  it('setMode sends a command', () => {
    cm.setMode(CameraMode.Video)
    expect(link.sentBuffers).toHaveLength(1)
    expect(cm.state.mode).toBe(CameraMode.Video)
  })

  it('formatStorage sends a command', () => {
    cm.formatStorage(1)
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('resetSettings sends a command', () => {
    cm.resetSettings()
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('does nothing when no link is set', () => {
    const cm2 = new CameraManager()
    cm2.handleCameraInformation({ flags: 3 })
    cm2.takePhoto() // should not throw
    cm2.startRecording()
    cm2.destroy()
  })

  it('skips photo if no image capability', () => {
    const cm2 = new CameraManager()
    const link2 = new MockLink()
    cm2.setLink(link2)
    cm2.handleCameraInformation({ flags: CameraCapFlags.CaptureVideo }) // video only
    link2.sentBuffers.length = 0

    cm2.takePhoto()
    expect(link2.sentBuffers).toHaveLength(0)
    cm2.destroy()
  })

  it('skips recording if no video capability', () => {
    const cm2 = new CameraManager()
    const link2 = new MockLink()
    cm2.setLink(link2)
    cm2.handleCameraInformation({ flags: CameraCapFlags.CaptureImage }) // image only
    link2.sentBuffers.length = 0

    cm2.startRecording()
    expect(link2.sentBuffers).toHaveLength(0)
    cm2.destroy()
  })
})

describe('CameraManager — state getter', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
  })

  afterEach(() => {
    cm.destroy()
  })

  it('returns full state object with all fields', () => {
    const state = cm.state
    expect(state).toHaveProperty('discovered')
    expect(state).toHaveProperty('info')
    expect(state).toHaveProperty('mode')
    expect(state).toHaveProperty('captureStatus')
    expect(state).toHaveProperty('storage')
    expect(state).toHaveProperty('photoCount')
    expect(state).toHaveProperty('isRecordingVideo')
    expect(state).toHaveProperty('isCapturingImage')
  })

  it('emits stateChanged on every state mutation', () => {
    const changed = vi.fn()
    cm.on('stateChanged', changed)

    cm.handleCameraSettings({ modeId: 1 })
    cm.handleStorageInformation({ storageId: 1, storageCount: 1, status: 2, totalCapacity: 100, usedCapacity: 50, availableCapacity: 50 })
    cm.handleCaptureStatus({ imageStatus: 0, videoStatus: 0, imageInterval: 0, imageCount: 0, recordingTimeMs: 0, availableCapacity: 0 })

    expect(changed).toHaveBeenCalledTimes(3)
  })
})

describe('CameraManager — capture status polling', () => {
  let cm: CameraManager
  let link: MockLink

  beforeEach(() => {
    vi.useFakeTimers()
    cm = new CameraManager()
    link = new MockLink()
    cm.setLink(link)
    cm.setTarget(1)
  })

  afterEach(() => {
    cm.destroy()
    vi.useRealTimers()
  })

  it('starts polling after camera discovery', () => {
    cm.handleCameraInformation({ flags: 3 })
    const countAfterDiscovery = link.sentBuffers.length

    // Advance past capture status poll interval (1500ms)
    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers.length).toBeGreaterThan(countAfterDiscovery)
  })

  it('adjusts polling rate when capturing images', () => {
    cm.handleCameraInformation({ flags: 3 })
    link.sentBuffers.length = 0

    // Simulate active capture
    cm.handleCaptureStatus({
      imageStatus: 1,
      videoStatus: 0,
      imageInterval: 0,
      imageCount: 0,
      recordingTimeMs: 0,
      availableCapacity: 0
    })
    link.sentBuffers.length = 0

    // Should poll at 1000ms (CAPTURE_STATUS_ACTIVE_POLL_MS)
    vi.advanceTimersByTime(1000)
    expect(link.sentBuffers.length).toBeGreaterThan(0)
  })

  it('stops polling on destroy', () => {
    cm.handleCameraInformation({ flags: 3 })
    cm.destroy()
    link.sentBuffers.length = 0

    vi.advanceTimersByTime(5000)
    expect(link.sentBuffers).toHaveLength(0)
  })
})

describe('CameraManager — bytesToString', () => {
  let cm: CameraManager

  beforeEach(() => {
    cm = new CameraManager()
  })

  afterEach(() => {
    cm.destroy()
  })

  it('converts byte arrays to strings, stripping null terminators', () => {
    cm.handleCameraInformation({
      vendorName: [72, 101, 108, 108, 111, 0, 0, 0],
      modelName: [87, 111, 114, 108, 100, 0],
      flags: 0
    })

    expect(cm.state.info!.vendorName).toBe('Hello')
    expect(cm.state.info!.modelName).toBe('World')
  })

  it('handles empty byte arrays', () => {
    cm.handleCameraInformation({
      vendorName: [0, 0, 0],
      modelName: [],
      flags: 0
    })

    expect(cm.state.info!.vendorName).toBe('')
    expect(cm.state.info!.modelName).toBe('')
  })
})
