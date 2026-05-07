import { kmlModule } from '@shared/ipc/modules/kml'
import { parseKmlFile } from '../../main/kml/KmlParser'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

export function registerKmlRpc(realtime: RpcRealtimeServer): void {
  realtime.registerModule(kmlModule, {
    commands: {
      import: async () => {
        throw new Error('KML file dialogs are not available in browser server mode')
      },
      importFromPath: async (filePath) => parseKmlFile(filePath)
    }
  })
}
