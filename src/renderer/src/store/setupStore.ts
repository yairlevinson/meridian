import { create } from 'zustand'
import type {
  SetupPage,
  CalibrationState,
  MagCalProgress,
  RcCalibrationState
} from '../../../shared-types/ipc/SetupTypes'
import { CalibrationStatus } from '../../../shared-types/ipc/SetupTypes'

interface SetupStore {
  activePage: SetupPage
  setActivePage: (page: SetupPage) => void

  calibrationState: CalibrationState | null
  setCalibrationState: (state: CalibrationState | null) => void

  magCalProgress: MagCalProgress[]
  setMagCalProgress: (progress: MagCalProgress[]) => void
  updateMagCalProgress: (progress: MagCalProgress) => void

  rcCalibrationState: RcCalibrationState | null
  setRcCalibrationState: (state: RcCalibrationState | null) => void
}

export const useSetupStore = create<SetupStore>((set) => ({
  activePage: 'summary',
  setActivePage: (page) => set({ activePage: page }),

  calibrationState: null,
  setCalibrationState: (state) => set({ calibrationState: state }),

  magCalProgress: [],
  setMagCalProgress: (progress) => set({ magCalProgress: progress }),
  updateMagCalProgress: (progress) =>
    set((prev) => {
      const idx = prev.magCalProgress.findIndex((p) => p.compassId === progress.compassId)
      const next = [...prev.magCalProgress]
      if (idx >= 0) {
        next[idx] = progress
      } else {
        next.push(progress)
      }
      return { magCalProgress: next }
    }),

  rcCalibrationState: null,
  setRcCalibrationState: (state) => set({ rcCalibrationState: state })
}))

// Wire IPC listeners when bridge is available
setTimeout(() => {
  const bridge = window.bridge
  if (!bridge) return

  if (bridge.onCalibrationStateChanged) {
    bridge.onCalibrationStateChanged(
      (payload: { vehicleId: number; state: CalibrationState }) => {
        useSetupStore.getState().setCalibrationState(payload.state)
        // Clear mag progress when calibration ends
        if (
          payload.state.status === CalibrationStatus.Complete ||
          payload.state.status === CalibrationStatus.Failed ||
          payload.state.status === CalibrationStatus.Cancelled ||
          payload.state.status === CalibrationStatus.Idle
        ) {
          useSetupStore.getState().setMagCalProgress([])
        }
      }
    )
  }

  if (bridge.onCalibrationMagProgress) {
    bridge.onCalibrationMagProgress((payload: { vehicleId: number } & MagCalProgress) => {
      useSetupStore.getState().updateMagCalProgress(payload)
    })
  }

  if (bridge.onRcCalibrationStateChanged) {
    bridge.onRcCalibrationStateChanged(
      (payload: { vehicleId: number; state: RcCalibrationState }) => {
        useSetupStore.getState().setRcCalibrationState(payload.state)
      }
    )
  }
}, 0)
