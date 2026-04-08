// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRadarStore } from '../src/renderer/src/store/radarStore'
import { useSettingsStore } from '../src/renderer/src/store/settingsStore'
import type { RadarState } from '../src/shared-types/ipc/RadarTypes'

/* ------------------------------------------------------------------ */
/*  Polyfill ImageData for jsdom                                      */
/* ------------------------------------------------------------------ */
if (typeof globalThis.ImageData === 'undefined') {
  ;(globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
      this.data = new Uint8ClampedArray(w * h * 4)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Stub HTMLCanvasElement.getContext before any imports               */
/* ------------------------------------------------------------------ */
HTMLCanvasElement.prototype.getContext = function () {
  return {
    shadowColor: '',
    shadowBlur: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h)
  } as unknown as CanvasRenderingContext2D
} as any

/* ------------------------------------------------------------------ */
/*  Lightweight mock of the maplibre-gl subset used by the hook       */
/* ------------------------------------------------------------------ */

/** Minimal GeoJSON source mock that tracks setData calls */
class MockGeoJSONSource {
  data: unknown
  constructor(config: { data: unknown }) {
    this.data = config.data
  }
  setData(d: unknown): void {
    this.data = d
  }
}

/** Minimal maplibre-gl Map mock with controllable style.load timing */
function createMockMap(opts: { styleLoaded?: boolean } = {}) {
  const listeners: Record<string, Set<(...args: unknown[]) => void>> = {}
  const sources: Record<string, MockGeoJSONSource> = {}
  const layers: Record<string, unknown> = {}
  const images = new Set<string>()
  let styleLoaded = opts.styleLoaded ?? false

  const map = {
    /* ---- style ---- */
    isStyleLoaded: () => styleLoaded,

    /* ---- events ---- */
    on(event: string, layerOrHandler: unknown, handler?: unknown) {
      const key = typeof layerOrHandler === 'string' ? `${event}:${layerOrHandler}` : event
      const fn = (typeof layerOrHandler === 'function' ? layerOrHandler : handler) as (
        ...a: unknown[]
      ) => void
      if (!listeners[key]) listeners[key] = new Set()
      listeners[key].add(fn)
    },
    off(event: string, layerOrHandler: unknown, handler?: unknown) {
      const key = typeof layerOrHandler === 'string' ? `${event}:${layerOrHandler}` : event
      const fn = (typeof layerOrHandler === 'function' ? layerOrHandler : handler) as (
        ...a: unknown[]
      ) => void
      listeners[key]?.delete(fn)
    },

    /* ---- sources ---- */
    addSource(id: string, config: { type: string; data: unknown }) {
      sources[id] = new MockGeoJSONSource({ data: config.data })
    },
    getSource(id: string): MockGeoJSONSource | undefined {
      return sources[id]
    },
    removeSource(id: string) {
      delete sources[id]
    },

    /* ---- layers ---- */
    addLayer(config: { id: string }) {
      layers[config.id] = config
    },
    getLayer(id: string) {
      return layers[id]
    },
    removeLayer(id: string) {
      delete layers[id]
    },

    /* ---- images ---- */
    addImage(id: string) {
      images.add(id)
    },
    hasImage(id: string) {
      return images.has(id)
    },
    removeImage(id: string) {
      images.delete(id)
    },

    /* ---- canvas (for hover popup effect) ---- */
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),

    /* ---- test helpers ---- */
    /** Simulate a style.load event (as when style finishes loading or after setStyle) */
    _fireStyleLoad() {
      styleLoaded = true
      for (const fn of listeners['style.load'] ?? []) fn()
    },
    /** Simulate setStyle(): clears user-added sources/layers, marks style as loading */
    _setStyle() {
      for (const id of Object.keys(layers)) delete layers[id]
      for (const id of Object.keys(sources)) delete sources[id]
      images.clear()
      styleLoaded = false
    },
    _sources: sources,
    _layers: layers,
    _images: images,
    _listeners: listeners
  }
  return map
}

/* ------------------------------------------------------------------ */
/*  Mock maplibre-gl module (Popup + Marker used by the hook)         */
/* ------------------------------------------------------------------ */

class MockPopup {
  setLngLat() {
    return this
  }
  setHTML() {
    return this
  }
  addTo() {
    return this
  }
  remove() {}
}

class MockMarker {
  _lngLat: [number, number] = [0, 0]
  _added = false
  constructor(_opts?: unknown) {}
  setLngLat(ll: [number, number]) {
    this._lngLat = ll
    return this
  }
  addTo() {
    this._added = true
    return this
  }
  remove() {
    this._added = false
  }
  on(_event: string, _fn: (...args: unknown[]) => void) {
    return this
  }
  getLngLat() {
    return { lat: this._lngLat[1], lng: this._lngLat[0] }
  }
  setDraggable() {
    return this
  }
  getElement() {
    return document.createElement('div')
  }
}

vi.mock('maplibre-gl', () => ({
  default: {
    Popup: MockPopup,
    Marker: MockMarker
  }
}))

/* ------------------------------------------------------------------ */
/*  Shared radar state fixture                                        */
/* ------------------------------------------------------------------ */

const RADAR_STATE: RadarState = {
  enabled: true,
  simulationActive: true,
  units: [{ id: 1, lat: 32.0, lon: 34.8, alt: 100 }],
  tracks: [
    {
      id: 1,
      sourceId: 1,
      affiliation: 'hostile',
      classification: 'uav',
      lat: 32.01,
      lon: 34.81,
      alt: 150,
      vn: 5,
      ve: 3,
      vd: 0,
      strength: 10,
      confidence: 85,
      lastSeenMs: Date.now()
    }
  ]
}

const RANGE_SOURCE = 'radar-range'
const TRACKS_SOURCE = 'radar-tracks'
const VELOCITY_SOURCE = 'radar-velocity'
const RANGE_FILL_LAYER = 'radar-range-fill'
const RANGE_STROKE_LAYER = 'radar-range-stroke'
const TRACKS_LAYER = 'radar-tracks-symbols'
const TRACKS_GLOW_LAYER = 'radar-tracks-glow'
const VELOCITY_LAYER = 'radar-velocity-lines'

const ALL_LAYERS = [
  RANGE_FILL_LAYER,
  RANGE_STROKE_LAYER,
  TRACKS_GLOW_LAYER,
  TRACKS_LAYER,
  VELOCITY_LAYER
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function setRadarActive(): void {
  useRadarStore.setState({ state: RADAR_STATE, scopeView: 'map' })
}

function hasAllLayers(map: ReturnType<typeof createMockMap>): boolean {
  return ALL_LAYERS.every((id) => !!map.getLayer(id))
}

function hasAllSources(map: ReturnType<typeof createMockMap>): boolean {
  return [RANGE_SOURCE, TRACKS_SOURCE, VELOCITY_SOURCE].every((id) => !!map.getSource(id))
}

/** True when the range source contains a real polygon (not EMPTY_FC) */
function rangeSourceHasData(map: ReturnType<typeof createMockMap>): boolean {
  const src = map.getSource(RANGE_SOURCE)
  if (!src) return false
  const fc = src.data as GeoJSON.FeatureCollection | undefined
  return !!fc && fc.features.length > 0
}

/** True when the tracks source has at least one feature */
function tracksSourceHasData(map: ReturnType<typeof createMockMap>): boolean {
  const src = map.getSource(TRACKS_SOURCE)
  if (!src) return false
  const fc = src.data as GeoJSON.FeatureCollection | undefined
  return !!fc && fc.features.length > 0
}

/* ------------------------------------------------------------------ */
/*  Import the hook under test AFTER mocks are set up                 */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let useRadarMapLayers: typeof import('../src/renderer/src/hooks/useRadarMapLayers').useRadarMapLayers

beforeEach(async () => {
  // Reset stores to known state
  useRadarStore.setState({ state: null, scopeView: 'radar', hoveredTrackId: null })
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      radarRadiusMeters: 5000,
      radarSimulationEnabled: true
    }
  })
  // Dynamic import so mocks are active
  const mod = await import('../src/renderer/src/hooks/useRadarMapLayers')
  useRadarMapLayers = mod.useRadarMapLayers
})

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('useRadarMapLayers', () => {
  describe('initial mount — style already loaded', () => {
    it('adds layers and populates data when radar is active', () => {
      setRadarActive()
      const map = createMockMap({ styleLoaded: true })

      renderHook(() => useRadarMapLayers(map as any))

      expect(hasAllLayers(map)).toBe(true)
      expect(hasAllSources(map)).toBe(true)
      expect(rangeSourceHasData(map)).toBe(true)
      expect(tracksSourceHasData(map)).toBe(true)
    })

    it('does not add layers when radar is inactive', () => {
      // Default store state: radar not enabled, scopeView = 'radar'
      const map = createMockMap({ styleLoaded: true })

      renderHook(() => useRadarMapLayers(map as any))

      expect(hasAllLayers(map)).toBe(false)
      expect(hasAllSources(map)).toBe(false)
    })
  })

  describe('initial mount — style loads asynchronously', () => {
    it('adds layers and populates data once style.load fires', () => {
      setRadarActive()
      const map = createMockMap({ styleLoaded: false })

      renderHook(() => useRadarMapLayers(map as any))

      // Before style loads: no layers
      expect(hasAllLayers(map)).toBe(false)

      // Simulate async style load
      act(() => map._fireStyleLoad())

      expect(hasAllLayers(map)).toBe(true)
      expect(hasAllSources(map)).toBe(true)
      expect(rangeSourceHasData(map)).toBe(true)
      expect(tracksSourceHasData(map)).toBe(true)
    })
  })

  describe('remount with new map instance (view navigation)', () => {
    it('restores layers and data after unmount → remount (style pre-loaded)', () => {
      setRadarActive()

      // --- First mount ---
      const map1 = createMockMap({ styleLoaded: true })
      const { unmount } = renderHook(() => useRadarMapLayers(map1 as any))

      expect(hasAllLayers(map1)).toBe(true)
      expect(rangeSourceHasData(map1)).toBe(true)

      // --- Unmount (user navigates to Settings) ---
      unmount()

      // Layers should have been cleaned up on the old map
      expect(hasAllLayers(map1)).toBe(false)
      expect(hasAllSources(map1)).toBe(false)

      // --- Remount with a NEW map (user navigates back to Fly) ---
      const map2 = createMockMap({ styleLoaded: true })
      renderHook(() => useRadarMapLayers(map2 as any))

      expect(hasAllLayers(map2)).toBe(true)
      expect(hasAllSources(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)
      expect(tracksSourceHasData(map2)).toBe(true)
    })

    it('restores layers and data after unmount → remount (style loads async)', () => {
      setRadarActive()

      // --- First mount ---
      const map1 = createMockMap({ styleLoaded: true })
      const { unmount } = renderHook(() => useRadarMapLayers(map1 as any))

      expect(hasAllLayers(map1)).toBe(true)

      // --- Unmount ---
      unmount()

      // --- Remount — style not yet loaded ---
      const map2 = createMockMap({ styleLoaded: false })
      renderHook(() => useRadarMapLayers(map2 as any))

      // Before style loads: nothing added
      expect(hasAllLayers(map2)).toBe(false)

      // style loads
      act(() => map2._fireStyleLoad())

      expect(hasAllLayers(map2)).toBe(true)
      expect(hasAllSources(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)
      expect(tracksSourceHasData(map2)).toBe(true)
    })
  })

  describe('setStyle during mount (simulates redundant provider effect)', () => {
    it('restores layers and data after setStyle clears them', () => {
      setRadarActive()
      const map = createMockMap({ styleLoaded: true })

      renderHook(() => useRadarMapLayers(map as any))

      // Layers and data present after initial setup
      expect(hasAllLayers(map)).toBe(true)
      expect(rangeSourceHasData(map)).toBe(true)

      // Simulate setStyle() clearing everything (as the provider effect does on mount)
      act(() => {
        map._setStyle()
        map._fireStyleLoad()
      })

      // After style.load, layers and data should be restored
      expect(hasAllLayers(map)).toBe(true)
      expect(hasAllSources(map)).toBe(true)
      expect(rangeSourceHasData(map)).toBe(true)
      expect(tracksSourceHasData(map)).toBe(true)
    })

    it('restores layers and data after remount + setStyle race', () => {
      setRadarActive()

      // First mount
      const map1 = createMockMap({ styleLoaded: true })
      const { unmount } = renderHook(() => useRadarMapLayers(map1 as any))
      unmount()

      // Remount — map starts with style loaded, but then setStyle is called
      // (simulating: init effect creates map, provider effect calls setStyle)
      const map2 = createMockMap({ styleLoaded: true })
      renderHook(() => useRadarMapLayers(map2 as any))

      // Layers were added because isStyleLoaded was true
      expect(hasAllLayers(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)

      // Now setStyle clears them (simulating provider effect's redundant setStyle)
      act(() => {
        map2._setStyle()
      })

      // Layers are gone
      expect(hasAllLayers(map2)).toBe(false)

      // style.load fires from the setStyle
      act(() => {
        map2._fireStyleLoad()
      })

      // Layers AND data should be fully restored
      expect(hasAllLayers(map2)).toBe(true)
      expect(hasAllSources(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)
      expect(tracksSourceHasData(map2)).toBe(true)
    })
  })

  describe('StrictMode double-mount lifecycle', () => {
    it('handles null → map1 → null → map2 (StrictMode mount/cleanup/remount)', () => {
      setRadarActive()

      const map1 = createMockMap({ styleLoaded: true })
      const map2 = createMockMap({ styleLoaded: true })

      const { rerender } = renderHook(({ m }) => useRadarMapLayers(m as any), {
        initialProps: { m: null as ReturnType<typeof createMockMap> | null }
      })

      // Step 1: init effect creates map1 → setMapInstance(map1)
      rerender({ m: map1 })
      expect(hasAllLayers(map1)).toBe(true)
      expect(rangeSourceHasData(map1)).toBe(true)

      // Step 2: StrictMode cleanup → setMapInstance(null), map1 destroyed
      rerender({ m: null })
      expect(hasAllLayers(map1)).toBe(false)

      // Step 3: StrictMode re-mount → new map2, setMapInstance(map2)
      rerender({ m: map2 })
      expect(hasAllLayers(map2)).toBe(true)
      expect(hasAllSources(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)
      expect(tracksSourceHasData(map2)).toBe(true)
    })

    it('handles StrictMode double-mount with async style load on map2', () => {
      setRadarActive()

      const map1 = createMockMap({ styleLoaded: true })
      const map2 = createMockMap({ styleLoaded: false })

      const { rerender } = renderHook(({ m }) => useRadarMapLayers(m as any), {
        initialProps: { m: null as ReturnType<typeof createMockMap> | null }
      })

      // Mount with map1 (style loaded)
      rerender({ m: map1 })
      expect(hasAllLayers(map1)).toBe(true)

      // StrictMode cleanup
      rerender({ m: null })

      // Re-mount with map2 (style NOT loaded yet)
      rerender({ m: map2 })
      expect(hasAllLayers(map2)).toBe(false)

      // Style loads on map2
      act(() => map2._fireStyleLoad())

      expect(hasAllLayers(map2)).toBe(true)
      expect(hasAllSources(map2)).toBe(true)
      expect(rangeSourceHasData(map2)).toBe(true)
      expect(tracksSourceHasData(map2)).toBe(true)
    })

    it('full navigation cycle: mount → navigate away → navigate back (with StrictMode)', () => {
      setRadarActive()

      // --- Initial mount (with StrictMode double-mount) ---
      const map1 = createMockMap({ styleLoaded: true })
      const map1b = createMockMap({ styleLoaded: true })

      const { rerender, unmount } = renderHook(({ m }) => useRadarMapLayers(m as any), {
        initialProps: { m: null as ReturnType<typeof createMockMap> | null }
      })

      // StrictMode mount cycle: null → map1 → null → map1b
      rerender({ m: map1 })
      rerender({ m: null })
      rerender({ m: map1b })
      expect(hasAllLayers(map1b)).toBe(true)
      expect(rangeSourceHasData(map1b)).toBe(true)

      // --- Navigate to Settings (full unmount) ---
      unmount()

      // --- Navigate back to Fly (fresh mount + StrictMode double-mount) ---
      const map2 = createMockMap({ styleLoaded: true })
      const map2b = createMockMap({ styleLoaded: true })

      const { rerender: rerender2 } = renderHook(({ m }) => useRadarMapLayers(m as any), {
        initialProps: { m: null as ReturnType<typeof createMockMap> | null }
      })

      // StrictMode mount cycle: null → map2 → null → map2b
      rerender2({ m: map2 })
      rerender2({ m: null })
      rerender2({ m: map2b })

      expect(hasAllLayers(map2b)).toBe(true)
      expect(hasAllSources(map2b)).toBe(true)
      expect(rangeSourceHasData(map2b)).toBe(true)
      expect(tracksSourceHasData(map2b)).toBe(true)
    })
  })

  describe('null map handling', () => {
    it('does nothing when map is null', () => {
      setRadarActive()
      // Should not throw
      const { unmount } = renderHook(() => useRadarMapLayers(null))
      unmount()
    })

    it('adds layers when map transitions from null to instance', () => {
      setRadarActive()
      const map = createMockMap({ styleLoaded: true })

      const { rerender } = renderHook(({ m }) => useRadarMapLayers(m as any), {
        initialProps: { m: null as ReturnType<typeof createMockMap> | null }
      })

      // No layers yet (map is null)
      expect(hasAllLayers(map)).toBe(false)

      // Simulate MapView calling setMapInstance after init
      rerender({ m: map })

      expect(hasAllLayers(map)).toBe(true)
      expect(rangeSourceHasData(map)).toBe(true)
      expect(tracksSourceHasData(map)).toBe(true)
    })
  })
})
