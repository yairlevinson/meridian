import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import { useMissionStore } from '../store/missionStore'
import type { EditableWaypoint } from '../../../shared-types/ipc/MissionTypes'

const PATH_SOURCE = 'mission-path'
const WP_SOURCE = 'mission-waypoints'
const HOME_PATH_SOURCE = 'mission-home-path'
const PATH_LAYER = 'mission-path-line'
const HOME_PATH_LAYER = 'mission-home-path-line'
const WP_CIRCLE_LAYER = 'mission-waypoints-circle'
const WP_LABEL_LAYER = 'mission-waypoints-label'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function buildPointFC(
  waypoints: EditableWaypoint[],
  selectedSeq: number | null
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: waypoints.map((wp) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [wp.lon, wp.lat] },
      properties: { seq: wp.seq, selected: wp.seq === selectedSeq }
    }))
  }
}

function buildLineFC(waypoints: EditableWaypoint[]): GeoJSON.FeatureCollection {
  const coords = waypoints.map((wp) => [wp.lon, wp.lat])
  if (coords.length < 2) return EMPTY_FC
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {}
      }
    ]
  }
}

function buildHomeLineFC(
  home: { lat: number; lon: number } | null,
  waypoints: EditableWaypoint[]
): GeoJSON.FeatureCollection {
  if (!home || waypoints.length === 0) return EMPTY_FC
  const first = waypoints[0]!
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [home.lon, home.lat],
            [first.lon, first.lat]
          ]
        },
        properties: {}
      }
    ]
  }
}

function addSourcesAndLayers(map: maplibregl.Map): void {
  if (map.getSource(PATH_SOURCE)) return // already added

  map.addSource(PATH_SOURCE, { type: 'geojson', data: EMPTY_FC })
  map.addSource(WP_SOURCE, { type: 'geojson', data: EMPTY_FC })
  map.addSource(HOME_PATH_SOURCE, { type: 'geojson', data: EMPTY_FC })

  map.addLayer({
    id: HOME_PATH_LAYER,
    type: 'line',
    source: HOME_PATH_SOURCE,
    paint: {
      'line-color': '#00e676',
      'line-width': 2,
      'line-opacity': 0.6,
      'line-dasharray': [4, 4]
    }
  })

  map.addLayer({
    id: PATH_LAYER,
    type: 'line',
    source: PATH_SOURCE,
    paint: {
      'line-color': '#00e676',
      'line-width': 3,
      'line-opacity': 0.9
    }
  })

  map.addLayer({
    id: WP_CIRCLE_LAYER,
    type: 'circle',
    source: WP_SOURCE,
    paint: {
      'circle-radius': ['case', ['==', ['get', 'selected'], true], 14, 10],
      'circle-color': '#00e676',
      'circle-stroke-color': 'white',
      'circle-stroke-width': 3,
      'circle-opacity': 0.95
    }
  })

  map.addLayer({
    id: WP_LABEL_LAYER,
    type: 'symbol',
    source: WP_SOURCE,
    layout: {
      'text-field': ['to-string', ['+', ['get', 'seq'], 1]],
      'text-size': 13,
      'text-font': ['Open Sans Regular'],
      'text-allow-overlap': true
    },
    paint: {
      'text-color': 'white',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1.5
    }
  })
}

function removeSourcesAndLayers(map: maplibregl.Map): void {
  for (const layerId of [WP_LABEL_LAYER, WP_CIRCLE_LAYER, PATH_LAYER, HOME_PATH_LAYER]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  for (const sourceId of [WP_SOURCE, PATH_SOURCE, HOME_PATH_SOURCE]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  }
}

export function useMissionMapLayers(map: maplibregl.Map | null, editMode: boolean): void {
  const dragSeqRef = useRef<number | null>(null)
  const handlersRef = useRef<{
    click?: (e: maplibregl.MapMouseEvent) => void
    mousedown?: (e: maplibregl.MapMouseEvent) => void
    mousemove?: (e: maplibregl.MapMouseEvent) => void
    mouseup?: (e: maplibregl.MapMouseEvent) => void
    styleLoad?: () => void
  }>({})

  // Setup sources/layers when map is available
  useEffect(() => {
    if (!map) return

    const setup = (): void => {
      addSourcesAndLayers(map)
      // Push initial data
      const { editableWaypoints, selectedWaypointSeq, plannedHome } = useMissionStore.getState()
      const wpSrc = map.getSource(WP_SOURCE) as GeoJSONSource | undefined
      const pathSrc = map.getSource(PATH_SOURCE) as GeoJSONSource | undefined
      const homePathSrc = map.getSource(HOME_PATH_SOURCE) as GeoJSONSource | undefined
      wpSrc?.setData(buildPointFC(editableWaypoints, selectedWaypointSeq))
      pathSrc?.setData(buildLineFC(editableWaypoints))
      homePathSrc?.setData(buildHomeLineFC(plannedHome, editableWaypoints))
    }

    if (map.isStyleLoaded()) {
      setup()
    } else {
      map.on('load', setup)
    }

    // Re-add on style reload
    const onStyleLoad = (): void => {
      setup()
    }
    handlersRef.current.styleLoad = onStyleLoad
    map.on('style.load', onStyleLoad)

    const handlers = handlersRef.current
    return () => {
      if (handlers.styleLoad) {
        map.off('style.load', handlers.styleLoad)
      }
      removeSourcesAndLayers(map)
    }
  }, [map])

  // Subscribe to store changes and update GeoJSON data
  useEffect(() => {
    if (!map) return

    let prevJson = ''
    const unsubscribe = useMissionStore.subscribe((state) => {
      const json = JSON.stringify({
        wps: state.editableWaypoints,
        sel: state.selectedWaypointSeq,
        home: state.plannedHome
      })
      if (json === prevJson) return
      prevJson = json

      const wpSrc = map.getSource(WP_SOURCE) as GeoJSONSource | undefined
      const pathSrc = map.getSource(PATH_SOURCE) as GeoJSONSource | undefined
      const homePathSrc = map.getSource(HOME_PATH_SOURCE) as GeoJSONSource | undefined
      wpSrc?.setData(buildPointFC(state.editableWaypoints, state.selectedWaypointSeq))
      pathSrc?.setData(buildLineFC(state.editableWaypoints))
      homePathSrc?.setData(buildHomeLineFC(state.plannedHome, state.editableWaypoints))
    })

    return unsubscribe
  }, [map])

  // Click handler (only in editMode)
  useEffect(() => {
    if (!map || !editMode) return

    const onClick = (e: maplibregl.MapMouseEvent): void => {
      const features = map.queryRenderedFeatures(e.point, { layers: [WP_CIRCLE_LAYER] })
      if (features.length > 0) {
        const seq = features[0]!.properties?.seq as number
        useMissionStore.getState().selectWaypoint(seq)
      } else {
        useMissionStore.getState().addWaypoint(e.lngLat.lat, e.lngLat.lng)
      }
    }

    handlersRef.current.click = onClick
    map.on('click', onClick)

    const handlers = handlersRef.current
    return () => {
      map.off('click', onClick)
      handlers.click = undefined
    }
  }, [map, editMode])

  // Drag handler (only in editMode)
  useEffect(() => {
    if (!map || !editMode) return

    const onMouseDown = (e: maplibregl.MapMouseEvent): void => {
      const features = map.queryRenderedFeatures(e.point, { layers: [WP_CIRCLE_LAYER] })
      if (features.length === 0) return

      e.preventDefault()
      dragSeqRef.current = features[0]!.properties?.seq as number
      map.dragPan.disable()
      map.getCanvas().style.cursor = 'grabbing'
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent): void => {
      if (dragSeqRef.current == null) return

      // Update source data directly for visual feedback
      const state = useMissionStore.getState()
      const wps = state.editableWaypoints.map((wp) =>
        wp.seq === dragSeqRef.current ? { ...wp, lat: e.lngLat.lat, lon: e.lngLat.lng } : wp
      )
      const wpSrc = map.getSource(WP_SOURCE) as GeoJSONSource | undefined
      const pathSrc = map.getSource(PATH_SOURCE) as GeoJSONSource | undefined
      wpSrc?.setData(buildPointFC(wps, state.selectedWaypointSeq))
      pathSrc?.setData(buildLineFC(wps))
    }

    const onMouseUp = (e: maplibregl.MapMouseEvent): void => {
      if (dragSeqRef.current == null) return

      useMissionStore.getState().moveWaypoint(dragSeqRef.current, e.lngLat.lat, e.lngLat.lng)
      dragSeqRef.current = null
      map.dragPan.enable()
      map.getCanvas().style.cursor = 'crosshair'
    }

    handlersRef.current.mousedown = onMouseDown
    handlersRef.current.mousemove = onMouseMove
    handlersRef.current.mouseup = onMouseUp

    map.on('mousedown', WP_CIRCLE_LAYER, onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)

    const handlers = handlersRef.current
    return () => {
      map.off('mousedown', WP_CIRCLE_LAYER, onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      dragSeqRef.current = null
      map.dragPan.enable()
      handlers.mousedown = undefined
      handlers.mousemove = undefined
      handlers.mouseup = undefined
    }
  }, [map, editMode])
}
