import { create } from 'zustand'
import type { OverlayLayer, KmlGeometry } from '../../../shared-types/ipc/OverlayTypes'

const STORAGE_KEY = 'meridian-overlays'

interface OverlayStore {
  layers: OverlayLayer[]
  focusLayerId: string | null

  addLayer: (name: string, geometries: KmlGeometry[]) => void
  removeLayer: (id: string) => void
  removeLayers: (ids: string[]) => void
  clearLayers: () => void
  toggleVisibility: (id: string) => void
  focusLayer: (id: string) => void
}

function generateId(): string {
  return `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function persist(layers: OverlayLayer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layers))
  } catch {
    // localStorage may be full or unavailable
  }
}

function loadPersisted(): OverlayLayer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as OverlayLayer[]
  } catch {
    return []
  }
}

export const useOverlayStore = create<OverlayStore>((set) => ({
  layers: typeof window !== 'undefined' ? loadPersisted() : [],
  focusLayerId: null,

  addLayer: (name, geometries) =>
    set((state) => {
      const layer: OverlayLayer = { id: generateId(), name, visible: true, geometries }
      const layers = [...state.layers, layer]
      persist(layers)
      return { layers }
    }),

  removeLayer: (id) =>
    set((state) => {
      const layers = state.layers.filter((l) => l.id !== id)
      persist(layers)
      return { layers }
    }),

  removeLayers: (ids) =>
    set((state) => {
      const idSet = new Set(ids)
      const layers = state.layers.filter((l) => !idSet.has(l.id))
      persist(layers)
      return { layers }
    }),

  clearLayers: () =>
    set(() => {
      persist([])
      return { layers: [] }
    }),

  toggleVisibility: (id) =>
    set((state) => {
      const layers = state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      persist(layers)
      return { layers }
    }),

  focusLayer: (id) => set({ focusLayerId: id })
}))
