import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useAllVehiclePositions, useActiveVehicleId, useHomePosition } from '../hooks/useVehicle'
import { useMissionStore } from '../store/missionStore'
import { useMissionMapLayers } from '../hooks/useMissionMapLayers'
import { useSettingsStore } from '../store/settingsStore'
import { providers, getProviderNames } from '../map/providers/ProviderRegistry'

const DEFAULT_CENTER: [number, number] = [34.8, 32.1]
const DEFAULT_ZOOM = 14
const DEFAULT_PROVIDER = 'google_satellite'

const COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#e84393',
  '#00cec9',
  '#fdcb6e'
]

function createMarkerEl(vehicleId: number, active: boolean, hdg = 0): HTMLDivElement {
  const size = active ? 48 : 40
  const color = COLORS[(vehicleId - 1) % COLORS.length]
  const stroke = active ? 'white' : 'rgba(255,255,255,0.8)'
  const shadow = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
  const el = document.createElement('div')
  el.style.cssText = `width: ${size}px; height: ${size}px; cursor: pointer; filter: ${shadow};`
  el.innerHTML = `
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform: rotate(${hdg}deg); transition: transform 0.2s ease;">
      <path d="M12 2 L20 20 L12 16 L4 20 Z" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
      <text x="12" y="14" text-anchor="middle" fill="white" font-size="7" font-weight="bold" font-family="monospace" stroke="black" stroke-width="0.5">${vehicleId}</text>
    </svg>
  `
  el.title = `Vehicle ${vehicleId}`
  return el
}

function createHomeMarkerEl(): HTMLDivElement {
  const size = 32
  const el = document.createElement('div')
  el.style.cssText = `width: ${size}px; height: ${size}px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));`
  el.innerHTML = `
    <svg viewBox="0 0 32 32" width="${size}" height="${size}">
      <circle cx="16" cy="16" r="14" fill="#fff" stroke="#00e676" stroke-width="3"/>
      <text x="16" y="21" text-anchor="middle" fill="#00e676" font-size="16" font-weight="bold" font-family="monospace">H</text>
    </svg>
  `
  el.title = 'Home'
  return el
}

function buildStyle(providerName: string): maplibregl.StyleSpecification {
  const provider = providers[providerName] ?? providers.osm!
  return {
    version: 8,
    sources: {
      tiles: {
        type: 'raster',
        tiles: [provider.tileUrlTemplate],
        tileSize: provider.tileSize ?? 256,
        attribution: provider.attribution,
        maxzoom: provider.maxZoom
      }
    },
    layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }]
  }
}

interface MapViewProps {
  editMode?: boolean
}

export function MapView({ editMode = false }: MapViewProps = {}): React.JSX.Element {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map())
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const hasCenteredRef = useRef(false)

  const positions = useAllVehiclePositions()
  const activeVehicleId = useActiveVehicleId()
  const homePos = useHomePosition()
  const mapProvider =
    (useSettingsStore((s) => s.settings.mapProvider) as string) || DEFAULT_PROVIDER
  const setSetting = useSettingsStore((s) => s.setSetting)

  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  useMissionMapLayers(mapInstance, editMode)

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(mapProvider),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM
    })

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-left')
    setMapInstance(mapRef.current)

    const markers = markersRef.current
    return () => {
      homeMarkerRef.current?.remove()
      homeMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setMapInstance(null)
      markers.clear()
      initializedRef.current = false
      hasCenteredRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch tile provider when setting changes
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setStyle(buildStyle(mapProvider))
  }, [mapProvider])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.getCanvas().style.cursor = editMode ? 'crosshair' : ''
  }, [editMode])

  useEffect(() => {
    if (!mapRef.current) return

    const map = mapRef.current
    const currentMarkers = markersRef.current
    const seenIds = new Set<number>()

    for (const { id, lat, lon, hdg } of positions) {
      seenIds.add(id)
      const lngLat: [number, number] = [lon, lat]
      const isActive = id === activeVehicleId

      let marker = currentMarkers.get(id)
      if (marker) {
        marker.setLngLat(lngLat)
        const el = marker.getElement()
        const size = isActive ? 48 : 40
        el.style.width = `${size}px`
        el.style.height = `${size}px`
        const svg = el.querySelector('svg') as SVGElement | null
        if (svg) {
          svg.setAttribute('width', String(size))
          svg.setAttribute('height', String(size))
          svg.style.transform = `rotate(${hdg}deg)`
          const path = svg.querySelector('path')
          if (path) {
            path.setAttribute('stroke', isActive ? 'white' : 'rgba(255,255,255,0.6)')
          }
        }
      } else {
        const el = createMarkerEl(id, isActive, hdg)
        marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
        currentMarkers.set(id, marker)
      }
    }

    for (const [id, marker] of currentMarkers) {
      if (!seenIds.has(id)) {
        marker.remove()
        currentMarkers.delete(id)
      }
    }

    if (positions.length > 0 && !hasCenteredRef.current) {
      const bounds = new maplibregl.LngLatBounds()
      for (const { lat, lon } of positions) {
        bounds.extend([lon, lat])
      }
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 500 })
      hasCenteredRef.current = true
    }
  }, [positions, activeVehicleId])

  // Home marker — draggable in edit mode so user can reposition planned home
  useEffect(() => {
    if (!mapRef.current) return

    if (homePos) {
      if (homeMarkerRef.current) {
        homeMarkerRef.current.setLngLat([homePos.lon, homePos.lat])
        homeMarkerRef.current.setDraggable(editMode)
      } else {
        const marker = new maplibregl.Marker({ element: createHomeMarkerEl(), draggable: editMode })
          .setLngLat([homePos.lon, homePos.lat])
          .addTo(mapRef.current)
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat()
          useMissionStore.getState().movePlannedHome(lngLat.lat, lngLat.lng)
        })
        homeMarkerRef.current = marker
      }
    } else if (homeMarkerRef.current) {
      homeMarkerRef.current.remove()
      homeMarkerRef.current = null
    }
  }, [homePos, editMode])

  const onProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSetting('mapProvider', e.target.value)
    },
    [setSetting]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} aria-label="Flight map" />
      <select
        value={mapProvider}
        onChange={onProviderChange}
        data-testid="map-provider-selector"
        style={{
          position: 'absolute',
          top: 'calc(var(--perf-bar-height) + 8px)',
          right: 8,
          zIndex: 10,
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.3)',
          background: 'rgba(0,0,0,0.7)',
          color: 'white',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        {getProviderNames().map((name) => (
          <option key={name} value={name}>
            {providers[name]!.displayName}
          </option>
        ))}
      </select>
    </div>
  )
}
