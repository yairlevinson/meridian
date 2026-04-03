import { EventEmitter } from 'events'
import { common } from 'mavlink-mappings'
import type { LinkInterface } from '../links/LinkInterface'
import { MavResult } from '@shared/ipc/MavCommandRequest'
import { createGcsProtocol } from '../mavlink/constants'
import { mavLog } from '../mavlink/trafficLog'

/** Anything that can write bytes — a LinkInterface or a simple callback */
export type WritableLink = LinkInterface | { writeBytes: (buf: Buffer) => void }

export interface PendingCommand {
  command: number
  param1: number
  param2: number
  param3: number
  param4: number
  param5: number
  param6: number
  param7: number
  targetSystem: number
  targetComponent: number
  retryCount: number
  maxRetries: number
  timeoutMs: number
  timer: ReturnType<typeof setTimeout> | null
  resolve: (result: MavResult) => void
  reject: (err: Error) => void
}

/**
 * Command queue with retry logic.
 * Mirrors MavCommandQueue from C++ QGroundControl.
 */
export class MavCommandQueue extends EventEmitter {
  private queue: PendingCommand[] = []
  private protocol = createGcsProtocol()
  private seq = 0
  private link: WritableLink | null = null

  static DEFAULT_TIMEOUT_MS = 1500
  static DEFAULT_MAX_RETRIES = 3

  setLink(link: WritableLink): void {
    this.link = link
  }

  /** Send a MAV_CMD_LONG command with retry */
  sendCommand(
    command: number,
    targetSystem: number,
    targetComponent: number,
    params: {
      p1?: number
      p2?: number
      p3?: number
      p4?: number
      p5?: number
      p6?: number
      p7?: number
    } = {},
    options: { timeoutMs?: number; maxRetries?: number } = {}
  ): Promise<MavResult> {
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        command,
        param1: params.p1 ?? 0,
        param2: params.p2 ?? 0,
        param3: params.p3 ?? 0,
        param4: params.p4 ?? 0,
        param5: params.p5 ?? 0,
        param6: params.p6 ?? 0,
        param7: params.p7 ?? 0,
        targetSystem,
        targetComponent,
        retryCount: 0,
        maxRetries: options.maxRetries ?? MavCommandQueue.DEFAULT_MAX_RETRIES,
        timeoutMs: options.timeoutMs ?? MavCommandQueue.DEFAULT_TIMEOUT_MS,
        timer: null,
        resolve,
        reject
      }
      this.queue.push(pending)
      this._sendPending(pending)
    })
  }

  /** Handle a COMMAND_ACK from the vehicle */
  handleCommandAck(ack: { command: number; result: number }): void {
    const idx = this.queue.findIndex((p) => p.command === ack.command)
    if (idx < 0) return

    const pending = this.queue[idx]!
    if (pending.timer) clearTimeout(pending.timer)
    this.queue.splice(idx, 1)

    const result = ack.result as MavResult
    if (result === MavResult.IN_PROGRESS) {
      // Re-queue for continued waiting
      pending.timer = setTimeout(() => this._handleTimeout(pending), pending.timeoutMs)
      this.queue.push(pending)
    } else {
      pending.resolve(result)
      this.emit('commandResult', { command: ack.command, result })
    }
  }

  /** Number of pending commands */
  get pendingCount(): number {
    return this.queue.length
  }

  /** Clear all pending commands */
  clear(): void {
    for (const p of this.queue) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error('Command queue cleared'))
    }
    this.queue = []
  }

  private _sendPending(pending: PendingCommand): void {
    if (!this.link) {
      pending.reject(new Error('No link available'))
      return
    }

    const cmd = new common.CommandLong()
    cmd.targetSystem = pending.targetSystem
    cmd.targetComponent = pending.targetComponent
    cmd.command = pending.command
    cmd.confirmation = pending.retryCount
    cmd._param1 = pending.param1
    cmd._param2 = pending.param2
    cmd._param3 = pending.param3
    cmd._param4 = pending.param4
    cmd._param5 = pending.param5
    cmd._param6 = pending.param6
    cmd._param7 = pending.param7

    mavLog.tx(76, pending.targetSystem, pending.targetComponent, {
      command: pending.command,
      p1: pending.param1,
      p2: pending.param2,
      p3: pending.param3,
      p4: pending.param4,
      p5: pending.param5,
      p6: pending.param6,
      p7: pending.param7,
      retry: pending.retryCount
    })
    const buf = this.protocol.serialize(cmd, this.seq++ & 0xff)
    this.link.writeBytes(buf)

    pending.timer = setTimeout(() => this._handleTimeout(pending), pending.timeoutMs)
  }

  private _handleTimeout(pending: PendingCommand): void {
    pending.retryCount++
    if (pending.retryCount > pending.maxRetries) {
      const idx = this.queue.indexOf(pending)
      if (idx >= 0) this.queue.splice(idx, 1)
      pending.reject(
        new Error(`Command ${pending.command} timed out after ${pending.maxRetries} retries`)
      )
      return
    }
    this._sendPending(pending)
  }
}
