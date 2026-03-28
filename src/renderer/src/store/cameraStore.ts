import { create } from 'zustand'
import type { CameraState } from '../../../shared-types/ipc/CameraTypes'

interface CameraStore {
  /** Per-vehicle camera state */
  cameras: Record<number, CameraState>
  /** Most recent image capture event */
  lastCapture: {
    vehicleId: number
    lat: number
    lon: number
    alt: number
    imageIndex: number
  } | null

  setCameraState: (vehicleId: number, state: CameraState) => void
  setLastCapture: (capture: CameraStore['lastCapture']) => void
}

export const useCameraStore = create<CameraStore>((set) => ({
  cameras: {},
  lastCapture: null,

  setCameraState: (vehicleId, state) =>
    set((prev) => ({
      cameras: { ...prev.cameras, [vehicleId]: state }
    })),

  setLastCapture: (capture) => set({ lastCapture: capture })
}))

// Wire IPC listeners on module load
if (typeof window !== 'undefined' && window.bridge) {
  window.bridge.onCameraStateChanged(({ vehicleId, state }) => {
    useCameraStore.getState().setCameraState(vehicleId, state)
  })

  window.bridge.onCameraImageCaptured((payload) => {
    useCameraStore.getState().setLastCapture({
      vehicleId: payload.vehicleId,
      lat: payload.lat,
      lon: payload.lon,
      alt: payload.alt,
      imageIndex: payload.imageIndex
    })
  })
}
