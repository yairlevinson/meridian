import { create } from 'zustand'
import type { LinkState } from '../../../shared-types/ipc/LinkState'

interface LinkStore {
  links: LinkState[]
  setLinks: (links: LinkState[]) => void
  updateLink: (updated: LinkState) => void
}

export const useLinkStore = create<LinkStore>((set) => ({
  links: [],
  setLinks: (links) => set({ links }),
  updateLink: (updated) =>
    set((prev) => ({
      links: prev.links.map((l) => (l.id === updated.id ? updated : l))
    }))
}))
