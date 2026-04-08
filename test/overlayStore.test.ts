// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useOverlayStore } from '../src/renderer/src/store/overlayStore'
import type { KmlGeometry } from '../src/shared-types/ipc/OverlayTypes'

const makeGeometry = (name = 'Zone'): KmlGeometry => ({
  name,
  type: 'polygon',
  vertices: [
    { lat: 30.9, lon: 34.8 },
    { lat: 30.9, lon: 34.9 },
    { lat: 31.0, lon: 34.9 },
    { lat: 30.9, lon: 34.8 }
  ],
  color: '#ff0000',
  lineWidth: 3
})

describe('overlayStore', () => {
  beforeEach(() => {
    useOverlayStore.setState({ layers: [] })
    localStorage.clear()
  })

  it('starts with empty layers', () => {
    expect(useOverlayStore.getState().layers).toEqual([])
  })

  it('adds a layer', () => {
    useOverlayStore.getState().addLayer('Test Layer', [makeGeometry()])
    const layers = useOverlayStore.getState().layers
    expect(layers).toHaveLength(1)
    expect(layers[0]!.name).toBe('Test Layer')
    expect(layers[0]!.visible).toBe(true)
    expect(layers[0]!.geometries).toHaveLength(1)
    expect(layers[0]!.id).toMatch(/^overlay-/)
  })

  it('removes a layer by id', () => {
    useOverlayStore.getState().addLayer('Layer 1', [makeGeometry()])
    useOverlayStore.getState().addLayer('Layer 2', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id

    useOverlayStore.getState().removeLayer(id)

    const layers = useOverlayStore.getState().layers
    expect(layers).toHaveLength(1)
    expect(layers[0]!.name).toBe('Layer 2')
  })

  it('removes multiple layers by ids', () => {
    useOverlayStore.getState().addLayer('A', [makeGeometry()])
    useOverlayStore.getState().addLayer('B', [makeGeometry()])
    useOverlayStore.getState().addLayer('C', [makeGeometry()])
    const ids = useOverlayStore
      .getState()
      .layers.slice(0, 2)
      .map((l) => l.id)

    useOverlayStore.getState().removeLayers(ids)

    const layers = useOverlayStore.getState().layers
    expect(layers).toHaveLength(1)
    expect(layers[0]!.name).toBe('C')
  })

  it('clears all layers', () => {
    useOverlayStore.getState().addLayer('A', [makeGeometry()])
    useOverlayStore.getState().addLayer('B', [makeGeometry()])

    useOverlayStore.getState().clearLayers()

    expect(useOverlayStore.getState().layers).toEqual([])
  })

  it('toggles visibility', () => {
    useOverlayStore.getState().addLayer('Layer', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id
    expect(useOverlayStore.getState().layers[0]!.visible).toBe(true)

    useOverlayStore.getState().toggleVisibility(id)
    expect(useOverlayStore.getState().layers[0]!.visible).toBe(false)

    useOverlayStore.getState().toggleVisibility(id)
    expect(useOverlayStore.getState().layers[0]!.visible).toBe(true)
  })

  it('persists layers to localStorage', () => {
    useOverlayStore.getState().addLayer('Persisted', [makeGeometry()])
    const stored = JSON.parse(localStorage.getItem('meridian-overlays')!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Persisted')
  })

  it('removeLayer persists the change', () => {
    useOverlayStore.getState().addLayer('A', [makeGeometry()])
    useOverlayStore.getState().addLayer('B', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id
    useOverlayStore.getState().removeLayer(id)

    const stored = JSON.parse(localStorage.getItem('meridian-overlays')!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('B')
  })

  it('focusLayer sets focusLayerId', () => {
    useOverlayStore.getState().addLayer('Target', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id

    expect(useOverlayStore.getState().focusLayerId).toBeNull()

    useOverlayStore.getState().focusLayer(id)
    expect(useOverlayStore.getState().focusLayerId).toBe(id)
  })

  it('focusLayer can be cleared by setting null', () => {
    useOverlayStore.getState().addLayer('Target', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id

    useOverlayStore.getState().focusLayer(id)
    expect(useOverlayStore.getState().focusLayerId).toBe(id)

    useOverlayStore.setState({ focusLayerId: null })
    expect(useOverlayStore.getState().focusLayerId).toBeNull()
  })
})
