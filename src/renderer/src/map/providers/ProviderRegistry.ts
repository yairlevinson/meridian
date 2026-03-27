import { tileProviders, quadkey } from '@shared/ipc/tileProviders'
export type { TileProviderDef } from '@shared/ipc/tileProviders'

export interface MapProvider {
  name: string
  displayName: string
  /** MapLibre tile URL template using {x}, {y}, {z} placeholders */
  tileUrlTemplate: string
  resolveUrl(x: number, y: number, z: number): string
  attribution: string
  maxZoom: number
  tileSize?: number
}

/** Build a MapProvider from a shared TileProviderDef */
function buildProvider(def: (typeof tileProviders)[string]): MapProvider {
  return {
    ...def,
    tileUrlTemplate: `tile://tiles/${def.name}/{z}/{x}/{y}`
  }
}

export const providers: Record<string, MapProvider> = Object.fromEntries(
  Object.entries(tileProviders).map(([key, def]) => [key, buildProvider(def)])
)

export function getProvider(name: string): MapProvider | undefined {
  return providers[name]
}

export function getProviderNames(): string[] {
  return Object.keys(providers)
}

export { quadkey }
