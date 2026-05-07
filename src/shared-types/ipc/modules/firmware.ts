import { command, event, defineIpcModule } from '../ipcModule'
import type { FirmwareUpgradeState } from '../SetupTypes'

export const firmwareModule = defineIpcModule({
  name: 'firmware',
  commands: {
    uploadFile: command<[vehicleId: number, filePath: string], void>(),
    uploadData: command<[vehicleId: number, fileName: string, dataBase64: string], void>(),
    cancel: command<[vehicleId: number], void>(),
    reboot: command<[vehicleId: number], void>(),
    getBoardInfo: command<[vehicleId: number], unknown>()
  },
  events: {
    upgradeStateChanged: event<{ vehicleId: number; state: FirmwareUpgradeState }>()
  }
})

export type FirmwareModule = typeof firmwareModule
