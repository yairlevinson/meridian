import { command, event, defineIpcModule } from '../ipcModule'
import type {
  CalibrationSensor,
  CalibrationState,
  MagCalProgress,
  MagCalReport
} from '../SetupTypes'

export const calibrationModule = defineIpcModule({
  name: 'calibration',
  commands: {
    start: command<[vehicleId: number, sensor: CalibrationSensor], void>(),
    cancel: command<[vehicleId: number], void>(),
    getState: command<[vehicleId: number], CalibrationState | null>()
  },
  events: {
    stateChanged: event<{ vehicleId: number; state: CalibrationState }>(),
    magProgress: event<{ vehicleId: number } & MagCalProgress>(),
    magReport: event<{ vehicleId: number } & MagCalReport>()
  }
})

export type CalibrationModule = typeof calibrationModule
