import { ipcRenderer } from 'electron'
import {
  type IpcModuleSpec,
  type ModuleBridge,
  commandChannel,
  eventChannel,
  commandBridgeKey,
  eventBridgeKey
} from '@shared/ipc/ipcModule'

/**
 * Generate a preload-side bridge object from a module spec. Produces one
 * `${module}${Command}` method per command (calls ipcRenderer.invoke) and
 * one `on${Module}${Event}` method per event (calls ipcRenderer.on).
 */
export function bindIpcModule<M extends IpcModuleSpec>(module: M): ModuleBridge<M> {
  const out: Record<string, unknown> = {}

  for (const cmdKey of Object.keys(module.commands)) {
    const channel = commandChannel(module.name, cmdKey)
    const methodName = commandBridgeKey(module.name, cmdKey)
    out[methodName] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  }

  for (const evKey of Object.keys(module.events)) {
    const channel = eventChannel(module.name, evKey)
    const methodName = eventBridgeKey(module.name, evKey)
    out[methodName] = (cb: (payload: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
      ipcRenderer.on(channel, handler)
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    }
  }

  return out as ModuleBridge<M>
}
