import { EventEmitter } from 'events'
import { common } from 'mavlink-mappings'
import type { LinkInterface } from '../links/LinkInterface'
import { createGcsProtocol } from '../mavlink/constants'
import { mavLog } from '../mavlink/trafficLog'
import {
  MissionType,
  MissionProtocolState,
  MissionError,
  type MissionItem
} from '@shared/ipc/MissionTypes'

const ACK_TIMEOUT_MS = 1500
const MAX_RETRY_COUNT = 5

/**
 * Base plan manager implementing the MAVLink mission protocol.
 * Handles both read (download) and write (upload) operations.
 */
export class PlanManager extends EventEmitter {
  protected missionType: MissionType
  protected items: MissionItem[] = []
  protected state = MissionProtocolState.Idle
  protected link: LinkInterface | null = null
  protected protocol = createGcsProtocol()
  protected seq = 0
  protected targetSystem = 1
  protected targetComponent = 0

  // Read state
  private expectedCount = 0
  private receivedItems: MissionItem[] = []
  private currentRequestIndex = 0
  private retryCount = 0
  private ackTimer: ReturnType<typeof setTimeout> | null = null

  // Write state
  private writeItems: MissionItem[] = []
  private lastWriteSeq = 0

  constructor(missionType: MissionType = MissionType.Mission) {
    super()
    this.missionType = missionType
  }

  get currentState(): MissionProtocolState {
    return this.state
  }

  get currentItems(): MissionItem[] {
    return [...this.items]
  }

  setLink(link: LinkInterface): void {
    this.link = link
  }

  setTarget(sysid: number, compid: number): void {
    this.targetSystem = sysid
    this.targetComponent = compid
  }

  /** Download mission items from vehicle */
  loadFromVehicle(): void {
    if (!this.link) return
    this.state = MissionProtocolState.ReadingCount
    this.receivedItems = []
    this.retryCount = 0
    this.emit('stateChanged', this.state)

    this._sendRequestList()
  }

  /** Send MISSION_REQUEST_LIST without resetting state */
  private _sendRequestList(): void {
    if (!this.link) return
    const req = new common.MissionRequestList()
    req.targetSystem = this.targetSystem
    req.targetComponent = this.targetComponent
    req.missionType = this.missionType as number as typeof req.missionType
    this.link.writeBytes(this.protocol.serialize(req, this.seq++ & 0xff))
    this._startAckTimer()
  }

  /** Upload mission items to vehicle */
  writeToVehicle(items: MissionItem[]): void {
    if (!this.link) return
    this.state = MissionProtocolState.WritingCount
    this.writeItems = items
    this.retryCount = 0
    this.emit('stateChanged', this.state)

    this._sendCount(items)
  }

  /** Send MISSION_COUNT without resetting state */
  private _sendCount(items: MissionItem[]): void {
    if (!this.link) return
    const count = new common.MissionCount()
    count.targetSystem = this.targetSystem
    count.targetComponent = this.targetComponent
    count.count = items.length
    count.missionType = this.missionType as number as typeof count.missionType
    this.link.writeBytes(this.protocol.serialize(count, this.seq++ & 0xff))
    this._startAckTimer()
  }

  /** Clear all items on vehicle */
  removeAll(): void {
    if (!this.link) return

    const clear = new common.MissionClearAll()
    clear.targetSystem = this.targetSystem
    clear.targetComponent = this.targetComponent
    clear.missionType = this.missionType as number as typeof clear.missionType
    this.link.writeBytes(this.protocol.serialize(clear, this.seq++ & 0xff))
    this._startAckTimer()
  }

  // ── Protocol message handlers ──────────────────────────────────

  /** Handle MISSION_COUNT from vehicle (response to REQUEST_LIST) */
  handleMissionCount(count: number): void {
    this._clearAckTimer()
    this.expectedCount = count
    this.receivedItems = []
    this.currentRequestIndex = 0

    if (count === 0) {
      this.items = []
      this.state = MissionProtocolState.Idle
      this.emit('stateChanged', this.state)
      this.emit('loadComplete', [])
      return
    }

    this.state = MissionProtocolState.ReadingItems
    this.emit('stateChanged', this.state)
    this._requestItem(0)
  }

  /** Handle MISSION_ITEM_INT from vehicle */
  handleMissionItemInt(item: MissionItem): void {
    this._clearAckTimer()
    this.receivedItems.push(item)

    this.emit('progress', {
      current: this.receivedItems.length,
      total: this.expectedCount
    })

    if (this.receivedItems.length >= this.expectedCount) {
      // Send MISSION_ACK
      this._sendAck(0) // ACCEPTED
      this.items = this.receivedItems
      this.state = MissionProtocolState.Idle
      this.emit('stateChanged', this.state)
      this.emit('loadComplete', this.items)
    } else {
      this._requestItem(this.receivedItems.length)
    }
  }

  /** Handle MISSION_REQUEST_INT from vehicle (during upload) */
  handleMissionRequest(seq: number): void {
    this._clearAckTimer()
    this.state = MissionProtocolState.WritingItems
    this.lastWriteSeq = seq

    const item = this.writeItems[seq]
    if (!item || !this.link) {
      this._error(MissionError.InvalidSequence)
      return
    }

    this._sendItem(item)
    this._startAckTimer()
  }

  private _sendItem(item: MissionItem): void {
    if (!this.link) return
    const mi = new common.MissionItemInt()
    mi.targetSystem = this.targetSystem
    mi.targetComponent = this.targetComponent
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
    mavLog.tx(73, this.targetSystem, this.targetComponent, {
      seq: mi.seq,
      cmd: mi.command,
      frame: mi.frame,
      x: mi.x,
      y: mi.y,
      z: mi.z,
      mtype: mi.missionType
    })
    this.link.writeBytes(this.protocol.serialize(mi, this.seq++ & 0xff))
  }

  /** Handle MISSION_ACK from vehicle */
  handleMissionAck(type: number): void {
    this._clearAckTimer()
    if (type === 0) {
      // ACCEPTED
      if (
        this.state === MissionProtocolState.WritingItems ||
        this.state === MissionProtocolState.WritingCount
      ) {
        this.state = MissionProtocolState.Idle
        this.emit('stateChanged', this.state)
        this.emit('writeComplete')
      } else {
        this.state = MissionProtocolState.Idle
        this.emit('stateChanged', this.state)
      }
    } else {
      this._error(type as MissionError)
    }
  }

  destroy(): void {
    this._clearAckTimer()
  }

  private _requestItem(seq: number): void {
    if (!this.link) return
    this.currentRequestIndex = seq

    const req = new common.MissionRequestInt()
    req.targetSystem = this.targetSystem
    req.targetComponent = this.targetComponent
    req.seq = seq
    req.missionType = this.missionType as number as typeof req.missionType
    this.link.writeBytes(this.protocol.serialize(req, this.seq++ & 0xff))
    this._startAckTimer()
  }

  private _sendAck(result: number): void {
    if (!this.link) return

    const ack = new common.MissionAck()
    ack.targetSystem = this.targetSystem
    ack.targetComponent = this.targetComponent
    ack.type = result
    ack.missionType = this.missionType as number as typeof ack.missionType
    this.link.writeBytes(this.protocol.serialize(ack, this.seq++ & 0xff))
  }

  private _startAckTimer(): void {
    this._clearAckTimer()
    this.ackTimer = setTimeout(() => this._handleTimeout(), ACK_TIMEOUT_MS)
  }

  private _clearAckTimer(): void {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer)
      this.ackTimer = null
    }
  }

  private _handleTimeout(): void {
    this.retryCount++
    if (this.retryCount > MAX_RETRY_COUNT) {
      this._error(MissionError.Timeout)
      return
    }

    // Retry based on current state
    if (this.state === MissionProtocolState.ReadingCount) {
      this._sendRequestList()
    } else if (this.state === MissionProtocolState.ReadingItems) {
      this._requestItem(this.currentRequestIndex)
    } else if (this.state === MissionProtocolState.WritingCount) {
      this._sendCount(this.writeItems)
    } else if (this.state === MissionProtocolState.WritingItems) {
      const item = this.writeItems[this.lastWriteSeq]
      if (item) this._sendItem(item)
    }
  }

  private _error(code: MissionError): void {
    this.state = MissionProtocolState.Error
    this.emit('stateChanged', this.state)
    this.emit('error', code)
  }
}
