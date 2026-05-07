import { command, event, defineIpcModule } from '../ipcModule'
import type { VideoStreamState } from '../VideoTypes'

export const videoModule = defineIpcModule({
  name: 'video',
  commands: {
    start: command<[sourceType: string, uri: string], void>(),
    stop: command<[], void>(),
    startRecording: command<[fileName: string], { filePath: string | null }>(),
    stopRecording: command<[], void>(),
    getState: command<[], VideoStreamState | null>()
  },
  events: {
    stateChanged: event<VideoStreamState>()
  }
})

export type VideoModule = typeof videoModule
