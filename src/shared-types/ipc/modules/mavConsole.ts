import { command, event, defineIpcModule } from '../ipcModule'

export const mavConsoleModule = defineIpcModule({
  name: 'mavConsole',
  commands: {
    write: command<[vehicleId: number, text: string], void>()
  },
  events: {
    data: event<{ vehicleId: number; text: string }>()
  }
})

export type MavConsoleModule = typeof mavConsoleModule
