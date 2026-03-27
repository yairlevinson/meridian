import { PlanManager } from './PlanManager'
import { MissionType } from '@shared/ipc/MissionTypes'

export class RallyPointManager extends PlanManager {
  constructor() {
    super(MissionType.Rally)
  }
}
