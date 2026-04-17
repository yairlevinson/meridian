import { command, event, defineIpcModule } from '../ipcModule'
import type { ForwardingState } from '../ForwardingTypes'

export const forwardingModule = defineIpcModule({
  name: 'forwarding',
  commands: {
    getState: command<[], ForwardingState>(),
    addTarget: command<[host: string, port: number], string>(),
    removeTarget: command<[id: string], void>(),
    setEnabled: command<[enabled: boolean], void>(),
    setTargetEnabled: command<[id: string, enabled: boolean], void>()
  },
  events: {
    stateChanged: event<ForwardingState>()
  }
})

export type ForwardingModule = typeof forwardingModule
