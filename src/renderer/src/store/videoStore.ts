import { create } from 'zustand'
import type { VideoStreamState } from '../../../shared-types/ipc/VideoTypes'
import { onBrowserRpcConnected } from '../transport/browserRpcEvents'

interface VideoStore {
  streamState: VideoStreamState | null
  fullScreen: boolean
  gridLines: boolean

  setStreamState: (state: VideoStreamState) => void
  setFullScreen: (value: boolean) => void
  toggleFullScreen: () => void
  setGridLines: (value: boolean) => void
}

export const useVideoStore = create<VideoStore>((set) => ({
  streamState: null,
  fullScreen: false,
  gridLines: false,

  setStreamState: (state) => set({ streamState: state }),
  setFullScreen: (value) => set({ fullScreen: value }),
  toggleFullScreen: () => set((prev) => ({ fullScreen: !prev.fullScreen })),
  setGridLines: (value) => set({ gridLines: value })
}))

function refreshVideoState(): void {
  window.bridge.videoGetState().then((state) => {
    if (state) useVideoStore.getState().setStreamState(state)
  })
}

// Wire IPC listener on module load
if (typeof window !== 'undefined' && window.bridge) {
  window.bridge.onVideoStateChanged((state) => {
    useVideoStore.getState().setStreamState(state)
  })

  refreshVideoState()
  onBrowserRpcConnected(refreshVideoState)
}
