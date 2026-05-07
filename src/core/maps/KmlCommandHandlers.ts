import type { RpcCommandImpls } from '@shared/rpc'
import type { KmlModule } from '@shared/ipc/modules/kml'
import { parseKmlFile } from './KmlParser'

export interface KmlCommandHandlerOptions {
  pickImportFile?: () => Promise<string | null>
  unavailableMessage?: string
}

export function createKmlCommandHandlers(
  options: KmlCommandHandlerOptions
): RpcCommandImpls<KmlModule> {
  return {
    import: async () => {
      if (!options.pickImportFile) {
        throw new Error(options.unavailableMessage ?? 'KML file dialogs are not available')
      }
      const filePath = await options.pickImportFile()
      if (!filePath) return { cancelled: true as const }
      return parseKmlFile(filePath)
    },
    importFromPath: async (filePath) => parseKmlFile(filePath)
  }
}
