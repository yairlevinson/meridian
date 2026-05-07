import type { RpcCommandImpls } from '@shared/rpc'
import type { VideoModule } from '@shared/ipc/modules/video'
import { VideoSourceType, type VideoStreamState } from '@shared/ipc/VideoTypes'

export interface VideoManagerLike {
  start: (sourceType: VideoSourceType, uri: string) => void
  stop: () => void
  startRecording: (fileName: string) => string | null
  stopRecording: () => void
  state: VideoStreamState | null
}

export function createVideoCommandHandlers(
  videoManager: VideoManagerLike
): RpcCommandImpls<VideoModule> {
  return {
    start: async (sourceType, uri) => {
      videoManager.start(sourceType as VideoSourceType, uri)
    },
    stop: async () => {
      videoManager.stop()
    },
    startRecording: async (fileName) => {
      return { filePath: videoManager.startRecording(fileName) }
    },
    stopRecording: async () => {
      videoManager.stopRecording()
    },
    getState: async () => videoManager.state
  }
}
