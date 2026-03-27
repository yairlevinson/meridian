import { EventEmitter } from 'events'
import { LinkConnectionStatus, type LinkConfig } from '@shared/ipc/LinkState'

export interface LinkEvents {
  data: (buf: Buffer) => void
  connected: () => void
  disconnected: () => void
  error: (err: Error) => void
}

/**
 * Abstract base class for all link transports.
 */
export abstract class LinkInterface extends EventEmitter {
  readonly id: string
  readonly config: LinkConfig
  private _status: LinkConnectionStatus = LinkConnectionStatus.Disconnected
  mavlinkChannel = -1

  constructor(id: string, config: LinkConfig) {
    super()
    this.id = id
    this.config = config
  }

  get status(): LinkConnectionStatus {
    return this._status
  }

  protected setStatus(status: LinkConnectionStatus): void {
    this._status = status
  }

  abstract connect(): Promise<void>
  abstract disconnect(): void
  abstract writeBytes(buf: Buffer): void

  get isConnected(): boolean {
    return this._status === LinkConnectionStatus.Connected
  }
}
