/**
 * Main-side bridge that spawns the utility process and exposes a typed RPC
 * client over a MessagePort. Phase 1 proves the plumbing with an `echo`
 * method; future phases will move MAVLink managers into the utility and
 * extend the method surface.
 */
import { utilityProcess, MessageChannelMain, type UtilityProcess } from 'electron'
import { EventEmitter } from 'events'
import { join } from 'path'
import type { UtilityRpcMessage } from '@shared/ipc/utilityRpc'
import { createLogger } from '../logger'

const log = createLogger('UtilityBridge')

export class UtilityBridge extends EventEmitter {
  private child: UtilityProcess | null = null
  private port: Electron.MessagePortMain | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  /** Spawn the utility process and hand it one end of a MessageChannel. */
  start(): void {
    if (this.child) return
    const entry = join(__dirname, 'utility.js')
    this.child = utilityProcess.fork(entry, [], {
      serviceName: 'meridian-mavlink',
      stdio: 'inherit'
    })

    const { port1, port2 } = new MessageChannelMain()
    this.port = port1
    port1.on('message', (event) => this._onMessage(event.data as UtilityRpcMessage))
    port1.start()

    this.child.on('spawn', () => {
      log.log(`utility spawned pid=${this.child?.pid}`)
      this.child!.postMessage(null, [port2])
    })
    this.child.on('exit', (code) => {
      log.warn(`utility exited code=${code}`)
      this._rejectAllPending(new Error(`utility exited: ${code}`))
      this.child = null
      this.port = null
    })
  }

  async stop(): Promise<void> {
    if (!this.child) return
    this._rejectAllPending(new Error('utility stopped'))
    this.child.kill()
    this.child = null
    this.port = null
  }

  /** Invoke an RPC method on the utility and await its response. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.port) return Promise.reject(new Error('utility not started'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const msg: UtilityRpcMessage = { kind: 'req', id, method, args }
      this.port!.postMessage(msg)
    })
  }

  private _onMessage(msg: UtilityRpcMessage): void {
    if (msg.kind === 'res') {
      const waiting = this.pending.get(msg.id)
      if (!waiting) return
      this.pending.delete(msg.id)
      if (msg.ok) waiting.resolve(msg.value)
      else waiting.reject(new Error(msg.error ?? 'utility RPC error'))
      return
    }
    if (msg.kind === 'evt') {
      this.emit(msg.channel, msg.payload)
    }
  }

  private _rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }
}
