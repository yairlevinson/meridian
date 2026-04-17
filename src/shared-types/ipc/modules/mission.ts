import { command, event, defineIpcModule } from '../ipcModule'
import type { MissionItem, PlanFile } from '../MissionTypes'

export const missionModule = defineIpcModule({
  name: 'mission',
  commands: {
    load: command<[vehicleId: number], { items: MissionItem[]; error?: string }>(),
    write: command<
      [vehicleId: number, items: MissionItem[]],
      { success: true } | { error: string }
    >(),
    savePlan: command<[planData: PlanFile], { filePath: string } | { cancelled: true }>(),
    openPlan: command<[], PlanFile | { cancelled: true }>()
  },
  events: {
    progress: event<{ vehicleId: number; current: number; total: number }>(),
    complete: event<{ vehicleId: number; items: MissionItem[] }>(),
    currentChanged: event<{ vehicleId: number; seq: number }>()
  }
})

export type MissionModule = typeof missionModule
