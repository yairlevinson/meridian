import { command, event, defineIpcModule } from '../ipcModule'
import type { RcCalibrationState } from '../SetupTypes'

export const rcCalibrationModule = defineIpcModule({
  name: 'rcCalibration',
  commands: {
    start: command<[vehicleId: number], void>(),
    nextStep: command<[vehicleId: number], void>(),
    cancel: command<[vehicleId: number], void>(),
    save: command<[vehicleId: number], void>()
  },
  events: {
    stateChanged: event<{ vehicleId: number; state: RcCalibrationState }>()
  }
})

export type RcCalibrationModule = typeof rcCalibrationModule
