import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import { useRadarStore } from '../store/radarStore'
import { useSettingsStore } from '../store/settingsStore'
import type { RadarState, RadarTrack, RadarUnit } from '../../../shared-types/ipc/RadarTypes'

const RANGE_SOURCE = 'radar-range'
const TRACKS_SOURCE = 'radar-tracks'
const VELOCITY_SOURCE = 'radar-velocity'
const RANGE_FILL_LAYER = 'radar-range-fill'
const RANGE_STROKE_LAYER = 'radar-range-stroke'
const TRACKS_LAYER = 'radar-tracks-symbols'
const TRACKS_GLOW_LAYER = 'radar-tracks-glow'
const VELOCITY_LAYER = 'radar-velocity-lines'

const FRIENDLY_ICON = 'radar-friendly'
const HOSTILE_ICON = 'radar-hostile'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const CIRCLE_POINTS = 64
const EARTH_RADIUS = 6371000

/** Create a diamond icon (friendly) as ImageData for MapLibre */
function createDiamondIcon(color: string, size: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 2

  // Glow
  ctx.shadowColor = color
  ctx.shadowBlur = 6

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + r * 0.7, cy)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - r * 0.7, cy)
  ctx.closePath()
  ctx.fill()

  // White stroke
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  return ctx.getImageData(0, 0, size, size)
}

/** Create a triangle icon (hostile) as ImageData for MapLibre */
function createTriangleIcon(color: string, size: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const r = size / 2 - 2

  // Glow
  ctx.shadowColor = color
  ctx.shadowBlur = 6

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, 2)
  ctx.lineTo(cx + r, size - 2)
  ctx.lineTo(cx - r, size - 2)
  ctx.closePath()
  ctx.fill()

  // White stroke
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  return ctx.getImageData(0, 0, size, size)
}

/** Generate a GeoJSON polygon approximating a circle */
function buildCirclePolygon(
  lat: number,
  lon: number,
  radiusMeters: number
): GeoJSON.FeatureCollection {
  const coords: [number, number][] = []
  for (let i = 0; i <= CIRCLE_POINTS; i++) {
    const angle = (i / CIRCLE_POINTS) * 2 * Math.PI
    const dLat = (radiusMeters / EARTH_RADIUS) * Math.cos(angle) * (180 / Math.PI)
    const dLon =
      ((radiusMeters / EARTH_RADIUS) * Math.sin(angle) * (180 / Math.PI)) /
      Math.cos(lat * (Math.PI / 180))
    coords.push([lon + dLon, lat + dLat])
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {}
      }
    ]
  }
}

function buildTracksFC(tracks: RadarTrack[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map((t) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] },
      properties: {
        id: t.id,
        affiliation: t.affiliation,
        color: t.affiliation === 'friendly' ? '#4488ff' : '#ff4444',
        heading: (Math.atan2(t.ve, t.vn) * 180) / Math.PI,
        alt: t.alt,
        speed: Math.sqrt(t.vn ** 2 + t.ve ** 2),
        strength: t.strength,
        confidence: t.confidence
      }
    }))
  }
}

function buildVelocityFC(tracks: RadarTrack[], radiusMeters: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((t) => Math.sqrt(t.vn ** 2 + t.ve ** 2) > 0.5)
      .map((t) => {
        const speed = Math.sqrt(t.vn ** 2 + t.ve ** 2)
        // Scale vector length proportional to radius (matching scope visual proportion)
        const maxLen = radiusMeters * 0.35
        const len = Math.min(speed * 5, maxLen)
        const dt = len / speed
        const dLat = ((t.vn * dt) / EARTH_RADIUS) * (180 / Math.PI)
        const dLon =
          (((t.ve * dt) / EARTH_RADIUS) * (180 / Math.PI)) / Math.cos(t.lat * (Math.PI / 180))
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [t.lon, t.lat],
              [t.lon + dLon, t.lat + dLat]
            ]
          },
          properties: {
            color: t.affiliation === 'friendly' ? '#4488ff' : '#ff4444'
          }
        }
      })
  }
}

function ensureIcons(map: maplibregl.Map): void {
  if (!map.hasImage(FRIENDLY_ICON)) {
    map.addImage(FRIENDLY_ICON, createDiamondIcon('#4488ff', 36), { pixelRatio: 2 })
  }
  if (!map.hasImage(HOSTILE_ICON)) {
    map.addImage(HOSTILE_ICON, createTriangleIcon('#ff4444', 36), { pixelRatio: 2 })
  }
}

function addSourcesAndLayers(map: maplibregl.Map): void {
  ensureIcons(map)

  if (!map.getSource(RANGE_SOURCE)) {
    map.addSource(RANGE_SOURCE, { type: 'geojson', data: EMPTY_FC })
  }
  if (!map.getSource(TRACKS_SOURCE)) {
    map.addSource(TRACKS_SOURCE, { type: 'geojson', data: EMPTY_FC })
  }
  if (!map.getSource(VELOCITY_SOURCE)) {
    map.addSource(VELOCITY_SOURCE, { type: 'geojson', data: EMPTY_FC })
  }

  if (!map.getLayer(RANGE_FILL_LAYER)) {
    map.addLayer({
      id: RANGE_FILL_LAYER,
      type: 'fill',
      source: RANGE_SOURCE,
      paint: {
        'fill-color': '#001a0a',
        'fill-opacity': 0.45
      }
    })
  }
  if (!map.getLayer(RANGE_STROKE_LAYER)) {
    map.addLayer({
      id: RANGE_STROKE_LAYER,
      type: 'line',
      source: RANGE_SOURCE,
      paint: {
        'line-color': '#00ff50',
        'line-width': 2,
        'line-opacity': 0.6
      }
    })
  }
  if (!map.getLayer(TRACKS_GLOW_LAYER)) {
    map.addLayer({
      id: TRACKS_GLOW_LAYER,
      type: 'circle',
      source: TRACKS_SOURCE,
      paint: {
        'circle-radius': 14,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.35,
        'circle-blur': 1
      }
    })
  }
  if (!map.getLayer(TRACKS_LAYER)) {
    map.addLayer({
      id: TRACKS_LAYER,
      type: 'symbol',
      source: TRACKS_SOURCE,
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'affiliation'], 'friendly'],
          FRIENDLY_ICON,
          HOSTILE_ICON
        ],
        'icon-size': 1,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: {
        'icon-opacity': 0.9
      }
    })
  }
  if (!map.getLayer(VELOCITY_LAYER)) {
    map.addLayer({
      id: VELOCITY_LAYER,
      type: 'line',
      source: VELOCITY_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2.5,
        'line-opacity': 0.7
      }
    })
  }
}

function removeLayers(map: maplibregl.Map): void {
  for (const id of [
    VELOCITY_LAYER,
    TRACKS_LAYER,
    TRACKS_GLOW_LAYER,
    RANGE_STROKE_LAYER,
    RANGE_FILL_LAYER
  ]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  for (const id of [VELOCITY_SOURCE, TRACKS_SOURCE, RANGE_SOURCE]) {
    if (map.getSource(id)) map.removeSource(id)
  }
  for (const id of [FRIENDLY_ICON, HOSTILE_ICON]) {
    if (map.hasImage(id)) map.removeImage(id)
  }
}

function updateSources(
  map: maplibregl.Map,
  radarState: RadarState | null,
  radiusMeters: number,
  prevCircleKeyRef: { current: string }
): void {
  if (!radarState) return
  const unit = radarState.units[0]
  if (!unit) return

  const circleKey = `${unit.lat},${unit.lon},${radiusMeters}`
  if (circleKey !== prevCircleKeyRef.current) {
    prevCircleKeyRef.current = circleKey
    const rangeData = buildCirclePolygon(unit.lat, unit.lon, radiusMeters)
    ;(map.getSource(RANGE_SOURCE) as GeoJSONSource)?.setData(rangeData)
  }

  const inRange = filterByRadius(radarState.tracks, unit, radiusMeters)
  ;(map.getSource(TRACKS_SOURCE) as GeoJSONSource)?.setData(buildTracksFC(inRange))
  ;(map.getSource(VELOCITY_SOURCE) as GeoJSONSource)?.setData(
    buildVelocityFC(inRange, radiusMeters)
  )
}

export function useRadarMapLayers(map: maplibregl.Map | null): void {
  const radarState = useRadarStore((s) => s.state)
  const scopeView = useRadarStore((s) => s.scopeView)
  const radiusMeters = useSettingsStore((s) => s.settings.radarRadiusMeters)
  const simEnabled = useSettingsStore((s) => s.settings.radarSimulationEnabled)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const layersAddedRef = useRef(false)
  const prevCircleKeyRef = useRef('')
  const radarStateLatestRef = useRef<RadarState | null>(null)
  const radiusLatestRef = useRef(radiusMeters)

  const active = radarState?.enabled && scopeView === 'map'

  // Keep refs in sync for async callbacks (style.load)
  useEffect(() => {
    radarStateLatestRef.current = radarState ?? null
    radiusLatestRef.current = radiusMeters
  })

  // Manage layer lifecycle — only runs when map or active changes
  useEffect(() => {
    if (!map) return

    const setup = (): void => {
      if (active && !layersAddedRef.current) {
        addSourcesAndLayers(map)
        layersAddedRef.current = true
      } else if (!active && layersAddedRef.current) {
        removeLayers(map)
        layersAddedRef.current = false
        prevCircleKeyRef.current = ''
      }
    }

    if (map.isStyleLoaded()) setup()
    const onStyleLoad = (): void => {
      layersAddedRef.current = false
      prevCircleKeyRef.current = ''
      setup()
    }
    map.on('style.load', onStyleLoad)

    return () => {
      map.off('style.load', onStyleLoad)
      if (layersAddedRef.current) {
        removeLayers(map)
        layersAddedRef.current = false
        prevCircleKeyRef.current = ''
      }
    }
  }, [map, active])

  // Update data when radar state changes (no layer teardown)
  useEffect(() => {
    if (!map || !active || !layersAddedRef.current) return
    updateSources(map, radarState ?? null, radiusMeters, prevCircleKeyRef)
  }, [map, active, radarState, radiusMeters])

  // Track hover popup
  useEffect(() => {
    if (!map || !active) return

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'radar-track-popup'
    })
    const onMouseEnter = (e: maplibregl.MapLayerMouseEvent): void => {
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (!f || !f.properties) return
      const p = f.properties
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number]
      const html = [
        `<strong style="color:${p.color}">${(p.affiliation as string).toUpperCase()}</strong> #${p.id}`,
        `Alt: ${Number(p.alt).toFixed(0)}m`,
        `Speed: ${Number(p.speed).toFixed(1)} m/s`,
        `RCS: ${Number(p.strength).toFixed(1)} dBsm`,
        `Conf: ${Number(p.confidence).toFixed(0)}%`
      ].join('<br/>')
      popup.setLngLat(coords).setHTML(html).addTo(map)
    }

    const onMouseLeave = (): void => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }

    map.on('mouseenter', TRACKS_LAYER, onMouseEnter)
    map.on('mouseleave', TRACKS_LAYER, onMouseLeave)

    return () => {
      map.off('mouseenter', TRACKS_LAYER, onMouseEnter)
      map.off('mouseleave', TRACKS_LAYER, onMouseLeave)
      popup.remove()
    }
  }, [map, active])

  // Draggable radar marker (simulation only)
  const showMarker = active && radarState?.simulationActive && simEnabled
  const unitLat = radarState?.units[0]?.lat
  const unitLon = radarState?.units[0]?.lon

  useEffect(() => {
    if (!map) return

    if (showMarker && unitLat != null && unitLon != null) {
      if (markerRef.current) {
        markerRef.current.setLngLat([unitLon, unitLat])
      } else {
        const el = createRadarMarkerEl()
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([unitLon, unitLat])
          .addTo(map)
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat()
          window.bridge?.radarSetSimPosition(lngLat.lat, lngLat.lng)
        })
        markerRef.current = marker
      }
    } else if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }
  }, [map, showMarker, unitLat, unitLon])

  // Clean up marker on unmount only
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
    }
  }, [])
}

function filterByRadius(tracks: RadarTrack[], unit: RadarUnit, radiusMeters: number): RadarTrack[] {
  return tracks.filter((t) => {
    const dLat = (t.lat - unit.lat) * (Math.PI / 180)
    const dLon = (t.lon - unit.lon) * (Math.PI / 180)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(unit.lat * (Math.PI / 180)) *
        Math.cos(t.lat * (Math.PI / 180)) *
        Math.sin(dLon / 2) ** 2
    const dist = 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a))
    return dist <= radiusMeters
  })
}

function createRadarMarkerEl(): HTMLDivElement {
  const size = 36
  const el = document.createElement('div')
  el.style.cssText = `width:${size}px;height:${size}px;cursor:grab;filter:drop-shadow(0 0 6px rgba(0,255,80,0.5));`
  el.innerHTML = `
    <svg viewBox="0 0 36 36" width="${size}" height="${size}">
      <circle cx="18" cy="18" r="15" fill="rgba(0,20,10,0.8)" stroke="#00ff50" stroke-width="2"/>
      <circle cx="18" cy="18" r="3" fill="#00ff50"/>
      <line x1="18" y1="3" x2="18" y2="10" stroke="#00ff50" stroke-width="1.5" opacity="0.6"/>
      <line x1="33" y1="18" x2="26" y2="18" stroke="#00ff50" stroke-width="1.5" opacity="0.6"/>
      <line x1="18" y1="33" x2="18" y2="26" stroke="#00ff50" stroke-width="1.5" opacity="0.6"/>
      <line x1="3" y1="18" x2="10" y2="18" stroke="#00ff50" stroke-width="1.5" opacity="0.6"/>
    </svg>
  `
  el.title = 'Drag to reposition radar'
  return el
}
