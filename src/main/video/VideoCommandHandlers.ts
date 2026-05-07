import type { RpcCommandImpls } from '@shared/rpc'
import type { VideoModule } from '@shared/ipc/modules/video'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import type { VideoManager } from './VideoManager'

export function createVideoCommandHandlers(
  videoManager: VideoManager
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
