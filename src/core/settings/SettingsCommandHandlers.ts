import type { RpcCommandImpls } from '@shared/rpc'
import type { SettingsModule } from '@shared/ipc/modules/settings'
import type { AppSettings } from '@shared/ipc/AppSettings'
import type { SettingsManager } from '../../main/settings/SettingsManager'

export function createSettingsCommandHandlers(
  settingsManager: SettingsManager
): RpcCommandImpls<SettingsModule> {
  return {
    getAll: async () => settingsManager.getAll(),
    set: async (key, value) => {
      settingsManager.set(key as keyof AppSettings, value as never)
    }
  }
}
