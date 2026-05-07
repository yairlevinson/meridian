import { EventEmitter } from 'events'
import type { VehicleManager } from '../../main/vehicle/VehicleManager'
import type { VehicleDeltaPayload } from '@shared/ipc/VehicleState'
import { createLogger } from '../../main/logger'

const log = createLogger('VehicleTelemetryPublisher')

export interface VehicleTelemetryPublisherOptions {
  tickRateMs?: number
  shouldPublish?: () => boolean
}

export interface VehicleTelemetryPublisherEvents {
  delta: [VehicleDeltaPayload]
}

export declare interface VehicleTelemetryPublisher {
  on<K extends keyof VehicleTelemetryPublisherEvents>(
    event: K,
    listener: (...args: VehicleTelemetryPublisherEvents[K]) => void
  ): this
  off<K extends keyof VehicleTelemetryPublisherEvents>(
    event: K,
    listener: (...args: VehicleTelemetryPublisherEvents[K]) => void
  ): this
  emit<K extends keyof VehicleTelemetryPublisherEvents>(
    event: K,
    ...args: VehicleTelemetryPublisherEvents[K]
  ): boolean
}

export class VehicleTelemetryPublisher extends EventEmitter {
  private readonly vehicleManager: VehicleManager
  private readonly shouldPublish: () => boolean
  private readonly interval: ReturnType<typeof setInterval>
  private sentCount = 0
  private skippedCount = 0
  private lastLogTime = Date.now()

  constructor(vehicleManager: VehicleManager, options: VehicleTelemetryPublisherOptions = {}) {
    super()
    this.vehicleManager = vehicleManager
    this.shouldPublish = options.shouldPublish ?? (() => true)
    this.interval = setInterval(() => this.tick(), options.tickRateMs ?? 33)
  }

  dispose(): void {
    clearInterval(this.interval)
    this.removeAllListeners()
  }

  tick(): void {
    if (!this.shouldPublish()) return
    if (this.vehicleManager.vehicleCount === 0) {
      this.resetStatsWindow()
      return
    }

    let anySent = false
    for (const vehicle of this.vehicleManager.getAllVehicles()) {
      if (!vehicle.hasDirty()) continue
      const delta = vehicle.getDelta()
      this.emit('delta', { vehicleId: vehicle.sysid, delta, sentAt: Date.now() })
      anySent = true
    }

    if (anySent) {
      this.sentCount++
    } else {
      this.skippedCount++
    }

    this.logStatsIfDue()
  }

  private logStatsIfDue(): void {
    const now = Date.now()
    if (now - this.lastLogTime < 5000) return

    const total = this.sentCount + this.skippedCount
    const skipPct = total > 0 ? ((this.skippedCount / total) * 100).toFixed(1) : '0.0'
    log.log(
      `sent=${this.sentCount} skipped=${this.skippedCount} skip_ratio=${skipPct}% vehicles=${this.vehicleManager.vehicleCount}`
    )
    this.sentCount = 0
    this.skippedCount = 0
    this.lastLogTime = now
  }

  private resetStatsWindow(): void {
    this.sentCount = 0
    this.skippedCount = 0
    this.lastLogTime = Date.now()
  }
}
