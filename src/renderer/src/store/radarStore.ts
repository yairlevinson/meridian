import { create } from 'zustand'
import type { RadarState } from '../../../shared-types/ipc/RadarTypes'

export type RadarView = 'radar' | 'map'

export interface TrackingNotice {
  vehicleId: number
  trackId: number
  reason: 'stale' | 'mode-changed' | 'disarmed' | 'engage-rejected'
  error?: string
  at: number
}

interface RadarStore {
  state: RadarState | null
  scopeView: RadarView
  hoveredTrackId: number | null
  trackedByVehicle: Map<number, number>
  trackingNotice: TrackingNotice | null

  setState: (state: RadarState) => void
  setScopeView: (view: RadarView) => void
  setHoveredTrack: (id: number | null) => void
  setTracked: (vehicleId: number, trackId: number | null) => void
  setTrackingNotice: (notice: TrackingNotice | null) => void
}

export const useRadarStore = create<RadarStore>((set) => ({
  state: null,
  scopeView: 'radar',
  hoveredTrackId: null,
  trackedByVehicle: new Map(),
  trackingNotice: null,

  setState: (state) => set({ state }),
  setScopeView: (view) => set({ scopeView: view }),
  setHoveredTrack: (id) => set({ hoveredTrackId: id }),
  setTracked: (vehicleId, trackId) =>
    set((s) => {
      const next = new Map(s.trackedByVehicle)
      if (trackId === null) next.delete(vehicleId)
      else next.set(vehicleId, trackId)
      return { trackedByVehicle: next }
    }),
  setTrackingNotice: (notice) => set({ trackingNotice: notice })
}))

// Wire IPC listeners at module load
if (typeof window !== 'undefined' && window.bridge) {
  setTimeout(() => {
    window.bridge.onRadarStateChanged((state) => {
      useRadarStore.getState().setState(state)
    })
    window.bridge.radarGetState().then((state) => {
      if (state) useRadarStore.getState().setState(state)
    })
    window.bridge.onVehicleTrackingChanged(({ vehicleId, trackId }) => {
      useRadarStore.getState().setTracked(vehicleId, trackId)
    })
    window.bridge.onVehicleTrackingLost(({ vehicleId, trackId, reason }) => {
      const store = useRadarStore.getState()
      store.setTrackingNotice({ vehicleId, trackId, reason, at: Date.now() })
      setTimeout(() => {
        const current = useRadarStore.getState().trackingNotice
        if (current && current.vehicleId === vehicleId && current.at) {
          useRadarStore.getState().setTrackingNotice(null)
        }
      }, 4000)
    })
  }, 0)
}
