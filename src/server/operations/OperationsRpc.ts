import { forwardingModule } from '@shared/ipc/modules/forwarding'
import { radarModule } from '@shared/ipc/modules/radar'
import type { ForwardingState } from '@shared/ipc/ForwardingTypes'
import type { RadarState } from '@shared/ipc/RadarTypes'
import {
  createForwardingCommandHandlers,
  createRadarCommandHandlers,
  type ForwarderLike,
  type RadarManagerLike
} from '../../core/operations/OperationCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

export type { RadarManagerLike } from '../../core/operations/OperationCommandHandlers'

export function registerForwardingRpc(
  realtime: RpcRealtimeServer,
  forwarder: ForwarderLike | null
): () => void {
  realtime.registerModule(forwardingModule, {
    commands: createForwardingCommandHandlers(forwarder)
  })

  if (!forwarder) return () => {}

  const onStateChanged = (state: ForwardingState): void => {
    realtime.emitEvent('forwarding', 'stateChanged', state)
  }
  forwarder.on('stateChanged', onStateChanged)
  return () => {
    forwarder.off('stateChanged', onStateChanged)
  }
}

export function registerRadarRpc(
  realtime: RpcRealtimeServer,
  radarManager: RadarManagerLike | null
): () => void {
  realtime.registerModule(radarModule, {
    commands: createRadarCommandHandlers(radarManager)
  })

  if (!radarManager) return () => {}

  const onStateChanged = (state: RadarState): void => {
    realtime.emitEvent('radar', 'stateChanged', state)
  }
  radarManager.on('stateChanged', onStateChanged)
  return () => {
    radarManager.off('stateChanged', onStateChanged)
  }
}
