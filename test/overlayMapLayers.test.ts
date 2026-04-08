// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { buildGeoJSON } from '../src/renderer/src/hooks/useOverlayMapLayers'
import type { KmlGeometry } from '../src/shared-types/ipc/OverlayTypes'

const makePolygon = (color: string, lineWidth: number): KmlGeometry => ({
  name: `zone-${color}`,
  type: 'polygon',
  vertices: [
    { lat: 30.9, lon: 34.8 },
    { lat: 30.9, lon: 34.9 },
    { lat: 31.0, lon: 34.9 },
    { lat: 30.9, lon: 34.8 }
  ],
  color,
  lineWidth
})

describe('buildGeoJSON', () => {
  it('preserves per-feature color, fillColor, and lineWidth in properties', () => {
    const geometries: KmlGeometry[] = [
      makePolygon('#097138', 4.175),
      makePolygon('#000000', 4.373),
      makePolygon('#c2185b', 3.877),
      makePolygon('#0097a7', 3.877)
    ]

    const fc = buildGeoJSON(geometries)
    expect(fc.features).toHaveLength(4)

    expect(fc.features[0]!.properties!.color).toBe('#097138')
    expect(fc.features[0]!.properties!.fillColor).toBe('#097138')
    expect(fc.features[0]!.properties!.lineWidth).toBe(4.175)

    expect(fc.features[1]!.properties!.color).toBe('#000000')
    expect(fc.features[1]!.properties!.lineWidth).toBe(4.373)
  })

  it('uses fillColor when provided, falls back to color', () => {
    const withFill: KmlGeometry = {
      ...makePolygon('#ff0000', 2),
      fillColor: '#00ff00'
    }
    const withoutFill = makePolygon('#ff0000', 2)

    const fc = buildGeoJSON([withFill, withoutFill])
    expect(fc.features[0]!.properties!.fillColor).toBe('#00ff00')
    expect(fc.features[1]!.properties!.fillColor).toBe('#ff0000') // falls back to color
  })

  it('includes linestring and point geometries', () => {
    const geometries: KmlGeometry[] = [
      makePolygon('#ff0000', 2),
      {
        name: 'line',
        type: 'linestring',
        vertices: [
          { lat: 0, lon: 0 },
          { lat: 1, lon: 1 }
        ],
        color: '#00ff00',
        lineWidth: 1
      },
      { name: 'pt', type: 'point', vertices: [{ lat: 5, lon: 10 }], color: '#0000ff', lineWidth: 1 }
    ]

    const fc = buildGeoJSON(geometries)
    expect(fc.features).toHaveLength(3)

    // polygon
    expect(fc.features[0]!.geometry.type).toBe('Polygon')
    expect(fc.features[0]!.properties!.color).toBe('#ff0000')

    // linestring
    expect(fc.features[1]!.geometry.type).toBe('LineString')
    expect((fc.features[1]!.geometry as GeoJSON.LineString).coordinates).toEqual([
      [0, 0],
      [1, 1]
    ])

    // point
    expect(fc.features[2]!.geometry.type).toBe('Point')
    expect((fc.features[2]!.geometry as GeoJSON.Point).coordinates).toEqual([10, 5])
  })

  it('filters out geometries with too few vertices', () => {
    const geometries: KmlGeometry[] = [
      {
        name: 'tiny-poly',
        type: 'polygon',
        vertices: [
          { lat: 0, lon: 0 },
          { lat: 1, lon: 1 }
        ],
        color: '#ff0000',
        lineWidth: 2
      },
      {
        name: 'single-line',
        type: 'linestring',
        vertices: [{ lat: 0, lon: 0 }],
        color: '#ff0000',
        lineWidth: 1
      },
      { name: 'empty-pt', type: 'point', vertices: [], color: '#ff0000', lineWidth: 1 }
    ]

    const fc = buildGeoJSON(geometries)
    expect(fc.features).toHaveLength(0)
  })

  it('returns empty FeatureCollection for no geometries', () => {
    const fc = buildGeoJSON([])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(0)
  })
})
