import { mavInspectorModule } from '@shared/ipc/modules/mavInspector'
import { MavlinkInspector } from '../../runtime/mavlink/MavlinkInspector'
import { createMavInspectorCommandHandlers } from '../../core/mavlink/MavInspectorCommandHandlers'
import type { DecodedMessage } from '../../main/mavlink/MavlinkChannel'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

type InspectorVehicleManagerLike = {
  onRawMessage?: (msg: DecodedMessage) => void
}

export function registerMavInspectorRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: InspectorVehicleManagerLike | null
): () => void {
  const inspector = new MavlinkInspector(
    (payload) => realtime.emitEvent('mavInspector', 'snapshot', payload),
    (payload) => realtime.emitEvent('mavInspector', 'fields', payload)
  )

  realtime.registerModule(mavInspectorModule, {
    commands: createMavInspectorCommandHandlers(inspector)
  })

  if (!vehicleManager) {
    return () => {
      inspector.disable()
    }
  }

  const previousRawMessageHandler = vehicleManager.onRawMessage
  const onRawMessage = (msg: DecodedMessage): void => {
    previousRawMessageHandler?.(msg)
    inspector.handleMessage(msg)
  }
  vehicleManager.onRawMessage = onRawMessage

  return () => {
    inspector.disable()
    if (vehicleManager.onRawMessage === onRawMessage) {
      vehicleManager.onRawMessage = previousRawMessageHandler
    }
  }
}
