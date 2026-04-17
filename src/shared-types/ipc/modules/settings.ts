import { command, event, defineIpcModule } from '../ipcModule'
import type { AppSettings } from '../AppSettings'

export const settingsModule = defineIpcModule({
  name: 'settings',
  commands: {
    getAll: command<[], AppSettings>(),
    set: command<[key: string, value: unknown], void>()
  },
  events: {
    changed: event<{ key: string; value: unknown }>()
  }
})

export type SettingsModule = typeof settingsModule
