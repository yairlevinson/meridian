import { MavlinkChannel, type DecodedMessage } from './MavlinkChannel'

const MAX_CHANNELS = 16

/**
 * Channel pool manager.
 * Allocates MavlinkChannel instances (0..15) matching the C++ implementation's
 * LinkInterface::_allocateMavlinkChannel / _freeMavlinkChannel.
 */
export class MavlinkProtocol {
  private channels: (MavlinkChannel | null)[] = new Array(MAX_CHANNELS).fill(null)

  /** Allocate a new channel. Returns the channel or throws if pool is full. */
  allocateChannel(onMessage: (msg: DecodedMessage) => void): MavlinkChannel {
    for (let i = 0; i < MAX_CHANNELS; i++) {
      if (this.channels[i] === null) {
        const channel = new MavlinkChannel(i)
        channel.onMessage(onMessage)
        this.channels[i] = channel
        return channel
      }
    }
    throw new Error('MavlinkProtocol: all 16 channels allocated')
  }

  /** Free a channel by id, making the slot available for reuse. */
  freeChannel(id: number): void {
    const channel = this.channels[id]
    if (channel) {
      channel.destroy()
      this.channels[id] = null
    }
  }

  /** Get a channel by id (may be null if not allocated). */
  getChannel(id: number): MavlinkChannel | null {
    return this.channels[id] ?? null
  }

  /** Number of currently allocated channels. */
  get allocatedCount(): number {
    return this.channels.filter((c) => c !== null).length
  }

  /** Destroy all channels. */
  destroy(): void {
    for (let i = 0; i < MAX_CHANNELS; i++) {
      this.freeChannel(i)
    }
  }
}
