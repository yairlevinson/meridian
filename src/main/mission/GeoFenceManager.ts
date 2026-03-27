import { PlanManager } from './PlanManager'
import { MissionType } from '@shared/ipc/MissionTypes'

export class GeoFenceManager extends PlanManager {
  constructor() {
    super(MissionType.Fence)
  }
}
