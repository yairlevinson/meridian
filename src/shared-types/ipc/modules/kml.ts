import { command, defineIpcModule } from '../ipcModule'
import type { KmlImportResult } from '../OverlayTypes'

export const kmlModule = defineIpcModule({
  name: 'kml',
  commands: {
    import: command<[], KmlImportResult | { cancelled: true }>(),
    importFromPath: command<[filePath: string], KmlImportResult>()
  },
  events: {}
})

export type KmlModule = typeof kmlModule
