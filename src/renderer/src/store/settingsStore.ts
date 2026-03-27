import { create } from 'zustand'

interface SettingsStore {
  settings: Record<string, unknown>
  setSetting: (key: string, value: unknown) => void
  setAll: (settings: Record<string, unknown>) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: {},
  setSetting: (key, value) =>
    set((prev) => ({
      settings: { ...prev.settings, [key]: value }
    })),
  setAll: (settings) => set({ settings })
}))
