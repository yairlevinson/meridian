import { PlanManager } from './PlanManager'
import { MissionType } from '@shared/ipc/MissionTypes'

/**
 * Mission-specific plan manager.
 * Extends PlanManager with mission-specific behavior.
 */
export class MissionManager extends PlanManager {
  private _currentIndex = 0

  constructor() {
    super(MissionType.Mission)
  }

  get currentMissionIndex(): number {
    return this._currentIndex
  }

  /** Handle MISSION_CURRENT message */
  handleMissionCurrent(seq: number): void {
    this._currentIndex = seq
    this.emit('currentChanged', seq)
  }
}
