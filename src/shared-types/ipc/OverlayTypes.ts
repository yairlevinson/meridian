/** KML/overlay geometry types */

/** A single parsed geometry from a KML file */
export interface KmlGeometry {
  name: string
  type: 'polygon' | 'linestring' | 'point'
  vertices: { lat: number; lon: number }[]
  /** Hex color string, e.g. '#ff0000' */
  color: string
  /** Hex fill color for polygons. Falls back to color if not set. */
  fillColor?: string
  /** Line width in pixels */
  lineWidth: number
}

/** Result of parsing a KML file */
export interface KmlImportResult {
  fileName: string
  geometries: KmlGeometry[]
}

/** A persisted overlay layer displayed on the map */
export interface OverlayLayer {
  id: string
  name: string
  visible: boolean
  geometries: KmlGeometry[]
}
