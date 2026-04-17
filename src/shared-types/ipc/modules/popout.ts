import { command, event, defineIpcModule } from '../ipcModule'

export type PopoutView = 'video' | 'map'

export const popoutModule = defineIpcModule({
  name: 'popout',
  commands: {
    open: command<[view: PopoutView], void>(),
    close: command<[view: PopoutView], void>()
  },
  events: {
    closed: event<{ view: string }>()
  }
})

export type PopoutModule = typeof popoutModule
