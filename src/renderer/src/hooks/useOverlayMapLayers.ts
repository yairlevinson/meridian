import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useOverlayStore } from '../store/overlayStore'
import type { OverlayLayer, KmlGeometry } from '../../../shared-types/ipc/OverlayTypes'

/** Source/layer ID prefix to avoid collisions with other map layers */
const PREFIX = 'overlay'

function sourceId(layerId: string): string {
  return `${PREFIX}-${layerId}`
}

function fillLayerId(layerId: string): string {
  return `${PREFIX}-fill-${layerId}`
}

function lineLayerId(layerId: string): string {
  return `${PREFIX}-line-${layerId}`
}

function pointLayerId(layerId: string): string {
  return `${PREFIX}-point-${layerId}`
}

export function buildGeoJSON(geometries: KmlGeometry[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries
      .filter((g) => {
        if (g.type === 'polygon') return g.vertices.length >= 3
        if (g.type === 'linestring') return g.vertices.length >= 2
        if (g.type === 'point') return g.vertices.length >= 1
        return false
      })
      .map((g) => {
        let geometry: GeoJSON.Geometry
        if (g.type === 'polygon') {
          geometry = {
            type: 'Polygon',
            coordinates: [g.vertices.map((v) => [v.lon, v.lat])]
          }
        } else if (g.type === 'linestring') {
          geometry = {
            type: 'LineString',
            coordinates: g.vertices.map((v) => [v.lon, v.lat])
          }
        } else {
          geometry = {
            type: 'Point',
            coordinates: [g.vertices[0]!.lon, g.vertices[0]!.lat]
          }
        }
        return {
          type: 'Feature' as const,
          geometry,
          properties: {
            color: g.color,
            fillColor: g.fillColor ?? g.color,
            lineWidth: g.lineWidth
          }
        }
      })
  }
}

function addOverlayLayer(map: maplibregl.Map, layer: OverlayLayer): void {
  const sid = sourceId(layer.id)
  if (map.getSource(sid)) return

  const geojson = buildGeoJSON(layer.geometries)
  map.addSource(sid, { type: 'geojson', data: geojson })

  const vis = layer.visible ? 'visible' : ('none' as const)

  map.addLayer({
    id: fillLayerId(layer.id),
    type: 'fill',
    source: sid,
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': 0.15
    },
    layout: { visibility: vis }
  })

  map.addLayer({
    id: lineLayerId(layer.id),
    type: 'line',
    source: sid,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'lineWidth'],
      'line-opacity': 0.9
    },
    layout: { visibility: vis }
  })

  map.addLayer({
    id: pointLayerId(layer.id),
    type: 'circle',
    source: sid,
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1
    },
    layout: { visibility: vis }
  })
}

function removeOverlayLayer(map: maplibregl.Map, layerId: string): void {
  const fid = fillLayerId(layerId)
  const lid = lineLayerId(layerId)
  const pid = pointLayerId(layerId)
  const sid = sourceId(layerId)
  if (map.getLayer(fid)) map.removeLayer(fid)
  if (map.getLayer(lid)) map.removeLayer(lid)
  if (map.getLayer(pid)) map.removeLayer(pid)
  if (map.getSource(sid)) map.removeSource(sid)
}

export function useOverlayMapLayers(map: maplibregl.Map | null): void {
  const activeLayerIdsRef = useRef<Set<string>>(new Set())
  const styleLoadRef = useRef<(() => void) | null>(null)
  const focusLayerId = useOverlayStore((s) => s.focusLayerId)

  // Setup and sync overlay layers
  useEffect(() => {
    if (!map) return

    const syncLayers = (): void => {
      const { layers } = useOverlayStore.getState()
      const currentIds = new Set(layers.map((l) => l.id))

      // Remove layers no longer in the store
      for (const id of activeLayerIdsRef.current) {
        if (!currentIds.has(id)) {
          removeOverlayLayer(map, id)
          activeLayerIdsRef.current.delete(id)
        }
      }

      // Add/update layers
      for (const layer of layers) {
        if (!activeLayerIdsRef.current.has(layer.id)) {
          addOverlayLayer(map, layer)
          activeLayerIdsRef.current.add(layer.id)
        }

        // Update visibility
        const fid = fillLayerId(layer.id)
        const lid = lineLayerId(layer.id)
        const pid = pointLayerId(layer.id)
        const vis = layer.visible ? 'visible' : 'none'
        if (map.getLayer(fid)) map.setLayoutProperty(fid, 'visibility', vis)
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', vis)
        if (map.getLayer(pid)) map.setLayoutProperty(pid, 'visibility', vis)
      }
    }

    // Initial sync
    if (map.isStyleLoaded()) {
      syncLayers()
    } else {
      map.on('load', syncLayers)
    }

    // Re-add on style reload (e.g., tile provider change)
    const onStyleLoad = (): void => {
      activeLayerIdsRef.current.clear()
      syncLayers()
    }
    styleLoadRef.current = onStyleLoad
    map.on('style.load', onStyleLoad)

    // Subscribe to store changes
    const unsubscribe = useOverlayStore.subscribe(() => {
      if (map.isStyleLoaded()) {
        syncLayers()
      }
    })

    const activeIds = activeLayerIdsRef.current
    return () => {
      unsubscribe()
      if (styleLoadRef.current) {
        map.off('style.load', styleLoadRef.current)
      }
      // Clean up all overlay layers from map
      for (const id of activeIds) {
        removeOverlayLayer(map, id)
      }
      activeIds.clear()
    }
  }, [map])

  // Fly to a layer when focusLayerId is set
  useEffect(() => {
    if (!map || !focusLayerId) return

    const layer = useOverlayStore.getState().layers.find((l) => l.id === focusLayerId)
    if (!layer) return

    const bounds = new maplibregl.LngLatBounds()
    for (const g of layer.geometries) {
      for (const v of g.vertices) {
        bounds.extend([v.lon, v.lat])
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, duration: 500 })
    }

    // Clear so clicking the same layer again works
    useOverlayStore.setState({ focusLayerId: null })
  }, [map, focusLayerId])
}
