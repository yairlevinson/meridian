import dgram from 'dgram'
import net from 'net'
import { EventEmitter } from 'events'
import type { LinkManager } from '../links/LinkManager'
import type { LinkInterface } from '../links/LinkInterface'
import type { SettingsManager } from '../settings/SettingsManager'
import type {
  ForwardingTargetConfig,
  ForwardingTargetState,
  ForwardingState
} from '@shared/ipc/ForwardingTypes'

export type { ForwardingTargetConfig, ForwardingTargetState, ForwardingState }

interface ForwardingTarget {
  config: ForwardingTargetConfig
  socket: dgram.Socket | null
  bytesForwarded: number
  packetsForwarded: number
  bytesReceived: number
  packetsReceived: number
  lastActivityMs: number
}

export class MavlinkForwarder extends EventEmitter {
  private targets = new Map<string, ForwardingTarget>()
  private enabled = false
  private targetCounter = 0
  private vehicleWriteFn: ((buf: Buffer) => void) | null = null
  private attachedLinks = new Map<string, (buf: Buffer) => void>()
  private ownPort: number

  constructor(
    private settings: SettingsManager,
    ownPort: number
  ) {
    super()
    this.ownPort = ownPort

    // Load saved config
    this.enabled = settings.get('mavlinkForwardingEnabled')
    const saved = settings.get('mavlinkForwardingTargets')
    for (const cfg of saved) {
      const target: ForwardingTarget = {
        config: cfg,
        socket: null,
        bytesForwarded: 0,
        packetsForwarded: 0,
        bytesReceived: 0,
        packetsReceived: 0,
        lastActivityMs: 0
      }
      this.targets.set(cfg.id, target)
      const idNum = parseInt(cfg.id.replace('fwd-', ''), 10)
      if (idNum >= this.targetCounter) this.targetCounter = idNum + 1
    }

    if (this.enabled) {
      for (const target of this.targets.values()) {
        if (target.config.enabled) this._openTarget(target)
      }
    }
  }

  setVehicleWriteFn(fn: (buf: Buffer) => void): void {
    this.vehicleWriteFn = fn
  }

  attachLinkManager(linkManager: LinkManager): void {
    // Attach to existing links
    for (const state of linkManager.getAllStates()) {
      const link = linkManager.getLink(state.id)
      if (link) this.attachLink(link)
    }

    linkManager.on('linkAdded', (link: LinkInterface) => {
      this.attachLink(link)
    })
    linkManager.on('linkRemoved', (link: LinkInterface) => {
      this.detachLink(link)
    })
  }

  attachLink(link: LinkInterface): void {
    if (this.attachedLinks.has(link.id)) return
    const handler = (buf: Buffer): void => this._onLinkData(buf)
    link.on('data', handler)
    this.attachedLinks.set(link.id, handler)
  }

  detachLink(link: LinkInterface): void {
    const handler = this.attachedLinks.get(link.id)
    if (handler) {
      link.removeListener('data', handler)
      this.attachedLinks.delete(link.id)
    }
  }

  addTarget(host: string, port: number): string {
    // Validate host
    if (!net.isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host)) {
      throw new Error(`Invalid host: ${host}`)
    }

    // Loop prevention
    if (port === this.ownPort && (host === '127.0.0.1' || host === 'localhost')) {
      throw new Error(`Cannot forward to own listen port ${this.ownPort}`)
    }

    // Duplicate prevention
    for (const t of this.targets.values()) {
      if (t.config.host === host && t.config.port === port) {
        throw new Error(`Target ${host}:${port} already exists`)
      }
    }

    const id = `fwd-${this.targetCounter++}`
    const config: ForwardingTargetConfig = { id, host, port, enabled: true }
    const target: ForwardingTarget = {
      config,
      socket: null,
      bytesForwarded: 0,
      packetsForwarded: 0,
      bytesReceived: 0,
      packetsReceived: 0,
      lastActivityMs: 0
    }
    this.targets.set(id, target)

    if (this.enabled) {
      this._openTarget(target)
    }

    this._persist()
    this._emitState()
    return id
  }

  removeTarget(id: string): void {
    const target = this.targets.get(id)
    if (!target) return
    this._closeTarget(target)
    this.targets.delete(id)
    this._persist()
    this._emitState()
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled

    if (enabled) {
      for (const target of this.targets.values()) {
        if (target.config.enabled) this._openTarget(target)
      }
    } else {
      for (const target of this.targets.values()) {
        this._closeTarget(target)
      }
    }

    this.settings.set('mavlinkForwardingEnabled', enabled)
    this._emitState()
  }

  setTargetEnabled(id: string, enabled: boolean): void {
    const target = this.targets.get(id)
    if (!target || target.config.enabled === enabled) return
    target.config.enabled = enabled

    if (this.enabled && enabled) {
      this._openTarget(target)
    } else {
      this._closeTarget(target)
    }

    this._persist()
    this._emitState()
  }

  getState(): ForwardingState {
    return {
      enabled: this.enabled,
      targets: Array.from(this.targets.values()).map((t) => ({
        id: t.config.id,
        host: t.config.host,
        port: t.config.port,
        enabled: t.config.enabled,
        active: t.socket !== null,
        bytesForwarded: t.bytesForwarded,
        packetsForwarded: t.packetsForwarded,
        bytesReceived: t.bytesReceived,
        packetsReceived: t.packetsReceived,
        lastActivityMs: t.lastActivityMs
      }))
    }
  }

  destroy(): void {
    for (const target of this.targets.values()) {
      this._closeTarget(target)
    }
    // Detach from all links
    for (const [linkId] of this.attachedLinks) {
      // Links may already be destroyed, just clear the map
      this.attachedLinks.delete(linkId)
    }
  }

  private _onLinkData(buf: Buffer): void {
    if (!this.enabled) return
    for (const target of this.targets.values()) {
      if (target.socket && target.config.enabled) {
        target.socket.send(buf, target.config.port, target.config.host)
        target.bytesForwarded += buf.length
        target.packetsForwarded++
        target.lastActivityMs = Date.now()
      }
    }
  }

  private _onTargetData(buf: Buffer, _targetId: string): void {
    if (!this.enabled || !this.vehicleWriteFn) return
    const target = this.targets.get(_targetId)
    if (target) {
      target.bytesReceived += buf.length
      target.packetsReceived++
      target.lastActivityMs = Date.now()
    }
    this.vehicleWriteFn(buf)
  }

  private _openTarget(target: ForwardingTarget): void {
    if (target.socket) return
    const socket = dgram.createSocket('udp4')
    socket.bind(0, () => {
      socket.unref()
    })
    socket.on('message', (msg) => {
      this._onTargetData(msg, target.config.id)
    })
    socket.on('error', (err) => {
      console.warn(`[MavlinkForwarder] Socket error for ${target.config.id}:`, err.message)
    })
    target.socket = socket
  }

  private _closeTarget(target: ForwardingTarget): void {
    if (!target.socket) return
    try {
      target.socket.close()
    } catch {
      // already closed
    }
    target.socket = null
  }

  private _persist(): void {
    this.settings.set(
      'mavlinkForwardingTargets',
      Array.from(this.targets.values()).map((t) => t.config)
    )
  }

  private _emitState(): void {
    this.emit('stateChanged', this.getState())
  }
}
