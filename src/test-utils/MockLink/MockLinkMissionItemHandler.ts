import { common } from 'mavlink-mappings'
import type { MissionItem } from '@shared/ipc/MissionTypes'
import type { MockLink } from './MockLink'
import { FailureMode } from './MockLink'

/**
 * Handles the mission protocol for MockLink.
 * Supports failure injection for testing error handling.
 */
export class MockLinkMissionItemHandler {
  private items: MissionItem[] = []
  private failureMode = FailureMode.NoFailure

  constructor(private link: MockLink) {}

  /** Load items that the mock vehicle "has" */
  setItems(items: MissionItem[]): void {
    this.items = items
  }

  /** Handle a MISSION_REQUEST_LIST from GCS */
  handleMissionRequestList(): void {
    if (this.failureMode === FailureMode.NoResponse) return

    const count = new common.MissionCount()
    count.targetSystem = 255
    count.targetComponent = 190
    count.count = this.items.length
    count.missionType = 0
    this.link.injectMessage(count)
  }

  /** Handle a MISSION_REQUEST_INT (or MISSION_REQUEST) from GCS */
  handleMissionRequestInt(seq: number): void {
    if (this.failureMode === FailureMode.NoResponse) return

    const item = this.items[seq]
    if (!item) return

    const mi = new common.MissionItemInt()
    mi.targetSystem = 255
    mi.targetComponent = 190
    mi.seq = item.seq
    mi.frame = item.frame
    mi.command = item.command
    mi.current = item.current ? 1 : 0
    mi.autocontinue = item.autocontinue ? 1 : 0
    mi.param1 = item.param1
    mi.param2 = item.param2
    mi.param3 = item.param3
    mi.param4 = item.param4
    mi.x = item.x
    mi.y = item.y
    mi.z = item.z
    mi.missionType = item.missionType as number as typeof mi.missionType
    this.link.injectMessage(mi)
  }

  /** Handle MISSION_COUNT from GCS (start of upload) */
  handleMissionCount(count: number): void {
    if (this.failureMode === FailureMode.NoResponse) return

    this.items = []
    // Request first item
    if (count > 0) {
      this._requestItem(0)
    }
  }

  /** Handle MISSION_ITEM_INT from GCS (receiving an item during upload) */
  handleMissionItemInt(item: MissionItem): void {
    if (this.failureMode === FailureMode.NoResponse) return

    this.items.push(item)

    // If we need more items, request next
    // Otherwise send MISSION_ACK
    if (item.seq < this.items.length - 1) {
      this._requestItem(item.seq + 1)
    } else {
      this._sendAck(0) // MAV_MISSION_ACCEPTED
    }
  }

  /** Handle MISSION_CLEAR_ALL */
  handleMissionClearAll(): void {
    if (this.failureMode === FailureMode.NoResponse) return
    this.items = []
    this._sendAck(0)
  }

  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode
  }

  getItems(): MissionItem[] {
    return [...this.items]
  }

  private _requestItem(seq: number): void {
    const req = new common.MissionRequestInt()
    req.targetSystem = 255
    req.targetComponent = 190
    req.seq = seq
    req.missionType = 0
    this.link.injectMessage(req)
  }

  private _sendAck(result: number): void {
    if (this.failureMode === FailureMode.NoAck) return

    const ack = new common.MissionAck()
    ack.targetSystem = 255
    ack.targetComponent = 190
    ack.type = result
    ack.missionType = 0
    this.link.injectMessage(ack)
  }
}
