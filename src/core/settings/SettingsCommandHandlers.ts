import type { RpcCommandImpls } from '@shared/rpc'
import type { SettingsModule } from '@shared/ipc/modules/settings'
import type { AppSettings } from '@shared/ipc/AppSettings'

export interface SettingsManagerLike {
  getAll: () => AppSettings
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

export function createSettingsCommandHandlers(
  settingsManager: SettingsManagerLike
): RpcCommandImpls<SettingsModule> {
  return {
    getAll: async () => settingsManager.getAll(),
    set: async (key, value) => {
      const settingKey = key as keyof AppSettings
      settingsManager.set(settingKey, value as AppSettings[typeof settingKey])
    }
  }
}
