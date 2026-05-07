import { promises as fs } from 'fs'
import { basename } from 'path'
import type { KmlImportResult } from '@shared/ipc/OverlayTypes'
export { parseKmlString, parseCoordinateString, kmlColorToHex } from '@shared/ipc/KmlParser'
import { parseKmlString } from '@shared/ipc/KmlParser'

/**
 * Parse a KML file and extract geometries with styles.
 */
export async function parseKmlFile(filePath: string): Promise<KmlImportResult> {
  const xml = await fs.readFile(filePath, 'utf-8')
  const geometries = parseKmlString(xml)
  return { fileName: basename(filePath), geometries }
}
