import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/ipc/AppSettings'

interface SettingsStore {
  settings: AppSettings
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  setAll: (settings: AppSettings) => void
}

/** Update local store only (no IPC) — used for incoming main-process changes */
function setLocal<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  useSettingsStore.setState((prev) => ({
    settings: { ...prev.settings, [key]: value }
  }))
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  setSetting: (key, value) => {
    set((prev) => ({
      settings: { ...prev.settings, [key]: value }
    }))
    window.bridge?.settingsSet(key, value)
  },
  setAll: (settings) => set({ settings })
}))

// Load settings from main process and subscribe to changes
setTimeout(() => {
  if (typeof window !== 'undefined' && window.bridge) {
    window.bridge.settingsGetAll().then((all) => {
      useSettingsStore.getState().setAll(all)
    })
    window.bridge.onSettingsChanged(({ key, value }) => {
      setLocal(key as keyof AppSettings, value as AppSettings[keyof AppSettings])
    })
  }
}, 0)
