import { EventEmitter } from 'events'
import type { LinkInterface } from '../links/LinkInterface'

/**
 * Manages the link(s) to a single vehicle.
 * Detects communication loss via heartbeat timeout.
 * Supports multi-link failover.
 */
export class VehicleLinkManager extends EventEmitter {
  private links: LinkInterface[] = []
  private primaryLinkIndex = 0
  private lastHeartbeatTime = new Map<string, number>()
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private _communicationLost = false

  /** Max time between heartbeats before declaring comm lost (ms) */
  heartbeatMaxElapsedMs: number
  /** How often to check for comm loss (ms) */
  commLostCheckMs: number

  constructor(options: { heartbeatMaxElapsedMs?: number; commLostCheckMs?: number } = {}) {
    super()
    this.heartbeatMaxElapsedMs = options.heartbeatMaxElapsedMs ?? 3500
    this.commLostCheckMs = options.commLostCheckMs ?? 1000
  }

  get communicationLost(): boolean {
    return this._communicationLost
  }

  get primaryLink(): LinkInterface | null {
    return this.links[this.primaryLinkIndex] ?? null
  }

  get linkCount(): number {
    return this.links.length
  }

  /** Add a link for this vehicle */
  addLink(link: LinkInterface): void {
    this.links.push(link)
    this.lastHeartbeatTime.set(link.id, Date.now())
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => this._checkHeartbeats(), this.commLostCheckMs)
    }
  }

  /** Remove a link */
  removeLink(linkId: string): void {
    const idx = this.links.findIndex((l) => l.id === linkId)
    if (idx < 0) return
    this.links.splice(idx, 1)
    this.lastHeartbeatTime.delete(linkId)

    // Adjust primary index
    if (this.primaryLinkIndex >= this.links.length) {
      this.primaryLinkIndex = Math.max(0, this.links.length - 1)
    }
  }

  /** Call when a heartbeat is received on a specific link */
  heartbeatReceived(linkId: string): void {
    this.lastHeartbeatTime.set(linkId, Date.now())

    if (this._communicationLost) {
      this._communicationLost = false
      this.emit('communicationRestored')
    }
  }

  /** Stop monitoring */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  private _checkHeartbeats(): void {
    const now = Date.now()
    let anyAlive = false

    for (const link of this.links) {
      const lastHb = this.lastHeartbeatTime.get(link.id) ?? 0
      if (now - lastHb < this.heartbeatMaxElapsedMs) {
        anyAlive = true
      }
    }

    if (!anyAlive && this.links.length > 0) {
      if (!this._communicationLost) {
        this._communicationLost = true
        this.emit('communicationLost')
      }
    }

    // Multi-link failover: if primary is lost, switch to another active link
    if (this.links.length > 1) {
      const primaryLink = this.links[this.primaryLinkIndex]
      if (primaryLink) {
        const primaryLastHb = this.lastHeartbeatTime.get(primaryLink.id) ?? 0
        if (now - primaryLastHb >= this.heartbeatMaxElapsedMs) {
          // Find a live link
          for (let i = 0; i < this.links.length; i++) {
            if (i === this.primaryLinkIndex) continue
            const link = this.links[i]!
            const lastHb = this.lastHeartbeatTime.get(link.id) ?? 0
            if (now - lastHb < this.heartbeatMaxElapsedMs) {
              this.primaryLinkIndex = i
              this.emit('primaryLinkChanged', link)
              break
            }
          }
        }
      }
    }
  }
}
