import { create } from 'zustand'
import type { RadarState } from '../../../shared-types/ipc/RadarTypes'

export type RadarView = 'radar' | 'map'

interface RadarStore {
  state: RadarState | null
  scopeView: RadarView
  hoveredTrackId: number | null

  setState: (state: RadarState) => void
  setScopeView: (view: RadarView) => void
  setHoveredTrack: (id: number | null) => void
}

export const useRadarStore = create<RadarStore>((set) => ({
  state: null,
  scopeView: 'radar',
  hoveredTrackId: null,

  setState: (state) => set({ state }),
  setScopeView: (view) => set({ scopeView: view }),
  setHoveredTrack: (id) => set({ hoveredTrackId: id })
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
  }, 0)
}
