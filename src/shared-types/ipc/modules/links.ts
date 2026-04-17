import { command, event, defineIpcModule } from '../ipcModule'
import type { LinkConfig, LinkState, SerialPortInfo } from '../LinkState'

export const linksModule = defineIpcModule({
  name: 'links',
  commands: {
    create: command<[config: LinkConfig], { id: string; status: string }>(),
    disconnect: command<[id: string], void>(),
    getAll: command<[], LinkState[]>(),
    listSerialPorts: command<[], SerialPortInfo[]>()
  },
  events: {
    stateChanged: event<LinkState[]>()
  }
})

export type LinksModule = typeof linksModule
