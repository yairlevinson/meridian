/** Tile provider URL resolution — shared between main process and renderer */

export interface TileProviderDef {
  name: string
  displayName: string
  resolveUrl(x: number, y: number, z: number): string
  attribution: string
  maxZoom: number
}

function quadkey(x: number, y: number, z: number): string {
  let key = ''
  for (let i = z; i > 0; i--) {
    let digit = 0
    const mask = 1 << (i - 1)
    if ((x & mask) !== 0) digit++
    if ((y & mask) !== 0) digit += 2
    key += digit
  }
  return key
}

export const tileProviders: Record<string, TileProviderDef> = {
  osm: {
    name: 'osm',
    displayName: 'OpenStreetMap',
    resolveUrl: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  },
  google_satellite: {
    name: 'google_satellite',
    displayName: 'Google Satellite',
    resolveUrl: (x, y, z) => {
      const server = ['mt0', 'mt1', 'mt2', 'mt3'][Math.abs(x + y) % 4]
      return `https://${server}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`
    },
    attribution: '© Google',
    maxZoom: 20
  },
  google_hybrid: {
    name: 'google_hybrid',
    displayName: 'Google Hybrid',
    resolveUrl: (x, y, z) => {
      const server = ['mt0', 'mt1', 'mt2', 'mt3'][Math.abs(x + y) % 4]
      return `https://${server}.google.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}`
    },
    attribution: '© Google',
    maxZoom: 20
  },
  bing_satellite: {
    name: 'bing_satellite',
    displayName: 'Bing Satellite',
    resolveUrl: (x, y, z) =>
      `https://ecn.t${Math.abs(x + y) % 4}.tiles.virtualearth.net/tiles/a${quadkey(x, y, z)}.jpeg?g=0`,
    attribution: '© Microsoft',
    maxZoom: 19
  },
  esri_satellite: {
    name: 'esri_satellite',
    displayName: 'Esri World Imagery',
    resolveUrl: (x, y, z) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri',
    maxZoom: 18
  },
  mapbox_satellite: {
    name: 'mapbox_satellite',
    displayName: 'Mapbox Satellite',
    resolveUrl: (x, y, z) => `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.png`,
    attribution: '© Mapbox',
    maxZoom: 22
  },
  statkart_topo: {
    name: 'statkart_topo',
    displayName: 'Statkart Topo',
    resolveUrl: (x, y, z) =>
      `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`,
    attribution: '© Kartverket',
    maxZoom: 18
  }
}

/** Resolve a tile:// URL to an HTTPS URL.
 *  Input format: "tile://tiles/{provider}/{z}/{x}/{y}" */
export function resolveTileUrl(tileUrl: string): string | null {
  const match = tileUrl.match(/^tile:\/\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/)
  if (!match) return null
  const [, providerName, zStr, xStr, yStr] = match
  const provider = tileProviders[providerName!]
  if (!provider) return null
  return provider.resolveUrl(parseInt(xStr!, 10), parseInt(yStr!, 10), parseInt(zStr!, 10))
}

export { quadkey }
