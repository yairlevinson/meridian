import { kmlModule } from '@shared/ipc/modules/kml'
import { createKmlCommandHandlers } from '../../core/maps/KmlCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

export function registerKmlRpc(realtime: RpcRealtimeServer): void {
  realtime.registerModule(kmlModule, {
    commands: createKmlCommandHandlers({
      unavailableMessage: 'KML file dialogs are not available in browser server mode'
    })
  })
}
