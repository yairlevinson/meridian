// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  providers,
  quadkey,
  getProvider,
  getProviderNames
} from '../src/renderer/src/map/providers/ProviderRegistry'
import { resolveTileUrl, tileProviders } from '../src/shared-types/ipc/tileProviders'

describe('Map Providers', () => {
  it('OSM resolves to openstreetmap.org URL', () => {
    const url = providers['osm']!.resolveUrl(1, 2, 3)
    expect(url).toBe('https://tile.openstreetmap.org/3/1/2.png')
  })

  it('OSM tile template uses tile:// scheme', () => {
    expect(providers['osm']!.tileUrlTemplate).toBe('tile://tiles/osm/{z}/{x}/{y}')
  })

  it('Google satellite uses mt0-mt3 rotation', () => {
    const servers = new Set<string>()
    for (let x = 0; x < 4; x++) {
      const url = providers['google_satellite']!.resolveUrl(x, 0, 10)
      const match = url.match(/https:\/\/(\w+)\.google/)
      if (match) servers.add(match[1]!)
    }
    expect(servers.size).toBeGreaterThanOrEqual(2)
  })

  it('Google satellite URL contains lyrs=s', () => {
    const url = providers['google_satellite']!.resolveUrl(100, 200, 15)
    expect(url).toContain('lyrs=s')
    expect(url).toContain('x=100')
    expect(url).toContain('y=200')
    expect(url).toContain('z=15')
  })

  it('Google hybrid URL contains lyrs=y', () => {
    const url = providers['google_hybrid']!.resolveUrl(100, 200, 15)
    expect(url).toContain('lyrs=y')
  })

  it('Bing uses correct quadkey encoding', () => {
    expect(quadkey(3, 5, 3)).toBe('213')
    expect(quadkey(0, 0, 1)).toBe('0')
    expect(quadkey(1, 0, 1)).toBe('1')
    expect(quadkey(0, 1, 1)).toBe('2')
    expect(quadkey(1, 1, 1)).toBe('3')
  })

  it('Bing satellite URL contains quadkey', () => {
    const url = providers['bing_satellite']!.resolveUrl(3, 5, 3)
    expect(url).toContain('a213')
  })

  it('Esri URL pattern correct', () => {
    const url = providers['esri_satellite']!.resolveUrl(10, 20, 8)
    expect(url).toContain('/8/20/10')
    expect(url).toContain('World_Imagery')
  })

  it('all providers have required fields', () => {
    for (const [name, provider] of Object.entries(providers)) {
      expect(provider.name).toBe(name)
      expect(provider.displayName.length).toBeGreaterThan(0)
      expect(provider.attribution.length).toBeGreaterThan(0)
      expect(provider.maxZoom).toBeGreaterThan(0)
      expect(provider.tileUrlTemplate).toContain('tile://tiles/')
      const url = provider.resolveUrl(1, 1, 1)
      expect(typeof url).toBe('string')
      expect(url).toMatch(/^https:\/\//)
    }
  })

  it('getProvider returns provider by name', () => {
    const osm = getProvider('osm')
    expect(osm?.name).toBe('osm')
    expect(getProvider('nonexistent')).toBeUndefined()
  })

  it('getProviderNames returns all provider names', () => {
    const names = getProviderNames()
    expect(names).toContain('osm')
    expect(names).toContain('google_satellite')
    expect(names).toContain('bing_satellite')
    expect(names.length).toBe(Object.keys(providers).length)
  })
})

describe('resolveTileUrl (shared)', () => {
  it('resolves OSM tile URL', () => {
    const url = resolveTileUrl('tile://tiles/osm/15/9876/12345')
    expect(url).toBe('https://tile.openstreetmap.org/15/9876/12345.png')
  })

  it('resolves Google satellite tile URL', () => {
    const url = resolveTileUrl('tile://tiles/google_satellite/15/100/200')
    expect(url).toContain('lyrs=s')
    expect(url).toContain('x=100')
    expect(url).toContain('y=200')
    expect(url).toContain('z=15')
  })

  it('resolves Bing satellite tile URL with quadkey', () => {
    const url = resolveTileUrl('tile://tiles/bing_satellite/3/3/5')
    expect(url).toContain('a213')
  })

  it('resolves Esri satellite tile URL', () => {
    const url = resolveTileUrl('tile://tiles/esri_satellite/8/10/20')
    expect(url).toContain('/8/20/10')
  })

  it('returns null for unknown provider', () => {
    expect(resolveTileUrl('tile://tiles/unknown/1/2/3')).toBeNull()
  })

  it('returns null for malformed URL', () => {
    expect(resolveTileUrl('https://example.com')).toBeNull()
    expect(resolveTileUrl('tile://bad')).toBeNull()
  })

  it('shared tileProviders match renderer providers', () => {
    const sharedNames = Object.keys(tileProviders)
    const rendererNames = getProviderNames()
    expect(sharedNames).toEqual(rendererNames)
  })
})
