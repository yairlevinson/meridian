import { EventEmitter } from 'events'
import type { LinkInterface } from '../links/LinkInterface'
import type { VehicleDialect } from './dialect'

/**
 * Per-vehicle runtime context shared with subsystems.
 *
 * `link` may be rebound as the primary link changes; subsystems are notified
 * via `VehicleSubsystem.bind()`. `sysid` and `compid` are fixed per vehicle.
 * `dialect` may be a getter that reflects the current HEARTBEAT — see
 * `Vehicle.ts` for the concrete implementation.
 */
export interface VehicleContext {
  readonly sysid: number
  readonly compid: number
  readonly link: LinkInterface
  readonly dialect: VehicleDialect
}

/**
 * Base class for vehicle-scoped managers. Replaces ad-hoc `setLink`/`setTarget`
 * setters with a single `bind(ctx)` entry point. Subclasses override `onBind()`
 * to react to (re)binding — typically copying ctx fields into private state
 * that the rest of the subsystem reads.
 *
 * Extends EventEmitter so subsystems can emit lifecycle events without needing
 * multiple inheritance.
 */
export abstract class VehicleSubsystem extends EventEmitter {
  protected ctx: VehicleContext | null = null

  bind(ctx: VehicleContext): void {
    this.ctx = ctx
    this.onBind()
  }

  protected onBind(): void {
    // default: no-op
  }
}
