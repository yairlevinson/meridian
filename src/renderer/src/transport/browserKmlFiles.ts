import { parseKmlString } from '@shared/ipc/KmlParser'
import type { KmlImportResult } from '@shared/ipc/OverlayTypes'

export function parseKmlImportText(text: string, fileName: string): KmlImportResult {
  return {
    fileName,
    geometries: parseKmlString(text)
  }
}

export function importKmlFromBrowserFile(): Promise<KmlImportResult | { cancelled: true }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')

    const cleanup = (): void => {
      input.remove()
    }

    input.type = 'file'
    input.accept = '.kml,application/vnd.google-earth.kml+xml,application/xml,text/xml'
    input.style.display = 'none'
    input.addEventListener('cancel', () => {
      cleanup()
      resolve({ cancelled: true })
    })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        cleanup()
        resolve({ cancelled: true })
        return
      }

      void file
        .text()
        .then((text) => resolve(parseKmlImportText(text, file.name)))
        .catch(reject)
        .finally(cleanup)
    })

    document.body.appendChild(input)
    input.click()
  })
}
