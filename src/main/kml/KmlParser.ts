import { XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'fs'
import { basename } from 'path'
import type { KmlGeometry, KmlImportResult } from '@shared/ipc/OverlayTypes'

const DEFAULT_COLOR = '#000000'
const DEFAULT_LINE_WIDTH = 2

/**
 * Parse a KML file and extract geometries with styles.
 */
export async function parseKmlFile(filePath: string): Promise<KmlImportResult> {
  const xml = await fs.readFile(filePath, 'utf-8')
  const geometries = parseKmlString(xml)
  return { fileName: basename(filePath), geometries }
}

/**
 * Parse a KML XML string and extract geometries with styles.
 */
export function parseKmlString(xml: string): KmlGeometry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => tagName === 'Placemark' || tagName === 'Folder'
  })
  const doc = parser.parse(xml)
  const kml = doc.kml ?? doc.KML
  if (!kml) return []

  const root = kml.Document ?? kml

  // Build style map: styleId → { color, lineWidth }
  const styles = parseStyles(root)
  const styleMaps = parseStyleMaps(root)

  // Collect placemarks from root and nested folders
  const placemarks = collectPlacemarks(root)
  const geometries: KmlGeometry[] = []

  for (const pm of placemarks) {
    const name = typeof pm.name === 'string' ? pm.name : ''
    const styleRef = resolveStyleRef(pm.styleUrl, styleMaps)
    const style = styles[styleRef] ?? {
      color: DEFAULT_COLOR,
      fillColor: undefined,
      lineWidth: DEFAULT_LINE_WIDTH
    }

    if (pm.Polygon) {
      const vertices = parsePolygonCoords(pm.Polygon as KmlNode)
      if (vertices.length > 0) {
        geometries.push({
          name,
          type: 'polygon',
          vertices,
          color: style.color,
          fillColor: style.fillColor,
          lineWidth: style.lineWidth
        })
      }
    }
    if (pm.LineString) {
      const vertices = parseCoordinateString(getCoordinateText(pm.LineString as KmlNode))
      if (vertices.length > 0) {
        geometries.push({
          name,
          type: 'linestring',
          vertices,
          color: style.color,
          fillColor: style.fillColor,
          lineWidth: style.lineWidth
        })
      }
    }
    if (pm.Point) {
      const vertices = parseCoordinateString(getCoordinateText(pm.Point as KmlNode))
      if (vertices.length > 0) {
        geometries.push({
          name,
          type: 'point',
          vertices,
          color: style.color,
          fillColor: style.fillColor,
          lineWidth: style.lineWidth
        })
      }
    }
  }

  return geometries
}

// --- Internals ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KmlNode = Record<string, any>

interface ParsedStyle {
  color: string
  fillColor?: string
  lineWidth: number
}

function parseStyles(root: KmlNode): Record<string, ParsedStyle> {
  const styles: Record<string, ParsedStyle> = {}
  const styleNodes = asArray<KmlNode>(root.Style)
  for (const s of styleNodes) {
    const id = s['@_id'] as string | undefined
    if (!id) continue
    const lineStyle = s.LineStyle as KmlNode | undefined
    const polyStyle = s.PolyStyle as KmlNode | undefined
    const color = lineStyle?.color ? kmlColorToHex(colorToString(lineStyle.color)) : DEFAULT_COLOR
    const lineWidth = lineStyle?.width ? Number(lineStyle.width) : DEFAULT_LINE_WIDTH
    const fillColor = polyStyle?.color ? kmlColorToHex(colorToString(polyStyle.color)) : undefined
    styles[`#${id}`] = { color, fillColor, lineWidth }
  }
  return styles
}

function parseStyleMaps(root: KmlNode): Record<string, string> {
  const maps: Record<string, string> = {}
  const mapNodes = asArray<KmlNode>(root.StyleMap)
  for (const sm of mapNodes) {
    const id = sm['@_id'] as string | undefined
    if (!id) continue
    const pairs = asArray<KmlNode>(sm.Pair)
    for (const pair of pairs) {
      if (pair.key === 'normal' && typeof pair.styleUrl === 'string') {
        maps[`#${id}`] = pair.styleUrl
      }
    }
  }
  return maps
}

function resolveStyleRef(styleUrl: unknown, styleMaps: Record<string, string>): string {
  if (typeof styleUrl !== 'string') return ''
  return styleMaps[styleUrl] ?? styleUrl
}

function collectPlacemarks(node: KmlNode): KmlNode[] {
  const result: KmlNode[] = []
  if (node.Placemark) {
    result.push(...asArray<KmlNode>(node.Placemark))
  }
  for (const folder of asArray<KmlNode>(node.Folder)) {
    result.push(...collectPlacemarks(folder))
  }
  return result
}

function parsePolygonCoords(polygon: KmlNode): { lat: number; lon: number }[] {
  const outer = polygon.outerBoundaryIs as KmlNode | undefined
  const ring = outer?.LinearRing as KmlNode | undefined
  if (!ring) return []
  return parseCoordinateString(getCoordinateText(ring))
}

function getCoordinateText(node: KmlNode): string {
  const coords = node.coordinates
  if (typeof coords === 'string') return coords
  if (typeof coords === 'number') return String(coords)
  return ''
}

/**
 * Parse a KML coordinate string: "lon,lat,alt lon,lat,alt ..."
 * Coordinates can be separated by whitespace and/or newlines.
 */
export function parseCoordinateString(text: string): { lat: number; lon: number }[] {
  if (!text.trim()) return []
  const vertices: { lat: number; lon: number }[] = []
  const tuples = text.trim().split(/\s+/)
  for (const tuple of tuples) {
    const parts = tuple.split(',')
    if (parts.length < 2) continue
    const lon = Number(parts[0])
    const lat = Number(parts[1])
    if (isNaN(lon) || isNaN(lat)) continue
    vertices.push({ lat, lon })
  }
  return vertices
}

/**
 * Convert KML color format (aabbggrr) to CSS hex (#rrggbb).
 * KML colors are in ABGR order.
 */
export function kmlColorToHex(kmlColor: string): string {
  const c = kmlColor.replace(/^#/, '')
  if (c.length !== 8) return DEFAULT_COLOR
  const rr = c.substring(6, 8)
  const gg = c.substring(4, 6)
  const bb = c.substring(2, 4)
  return `#${rr}${gg}${bb}`
}

/** Convert a parsed color value to a string, re-padding leading zeros lost by numeric parsing. */
function colorToString(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val === 'number') return val.toString().padStart(8, '0')
  return ''
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return []
  return Array.isArray(val) ? val : [val]
}
