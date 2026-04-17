import { command, event, defineIpcModule } from '../ipcModule'
import type { Parameter, ParameterLoadState } from '../ParameterTypes'

export const parametersModule = defineIpcModule({
  name: 'parameters',
  commands: {
    getAll: command<[vehicleId: number], Parameter[]>(),
    set: command<[vehicleId: number, name: string, value: number], void>(),
    refresh: command<[vehicleId: number], void>()
  },
  events: {
    changed: event<{ vehicleId: number; parameter: Parameter }>(),
    ready: event<{ vehicleId: number }>(),
    progress: event<{ vehicleId: number; loadState: ParameterLoadState }>()
  }
})

export type ParametersModule = typeof parametersModule
