import { mavInspectorModule } from '@shared/ipc/modules/mavInspector'
import { MavlinkInspector } from '../../main/mavlink/MavlinkInspector'
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
    commands: {
      enable: async () => inspector.enable(),
      disable: async () => inspector.disable(),
      select: async (sysid, compid, msgid) => inspector.select(sysid, compid, msgid),
      deselect: async () => inspector.deselect()
    }
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
