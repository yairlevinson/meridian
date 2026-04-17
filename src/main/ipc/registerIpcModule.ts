import { ipcMain, BrowserWindow } from 'electron'
import type { IpcModuleSpec, EventMarker } from '@shared/ipc/ipcModule'
import { commandChannel, eventChannel } from '@shared/ipc/ipcModule'

/** Implementation map for a module's commands. */
type CommandImpls<M extends IpcModuleSpec> = {
  [K in keyof M['commands']]: (
    ...args: Parameters<M['commands'][K]>
  ) => ReturnType<M['commands'][K]> | Awaited<ReturnType<M['commands'][K]>>
}

/** Wiring function for a module's events: accepts an `emit` callback and returns a disposer. */
type EventWiring<M extends IpcModuleSpec> = {
  [K in keyof M['events']]: (
    emit: (payload: M['events'][K] extends EventMarker<infer P> ? P : never) => void
  ) => () => void
}

export interface ModuleImpl<M extends IpcModuleSpec> {
  commands: CommandImpls<M>
  events: EventWiring<M>
}

/** Broadcast helper — sends an event to every open BrowserWindow. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

/**
 * Register a module's commands (ipcMain.handle) and event broadcasts.
 * Returns a disposer that removes all handlers and event subscriptions.
 */
export function registerIpcModule<M extends IpcModuleSpec>(
  module: M,
  impl: ModuleImpl<M>
): () => void {
  const disposers: Array<() => void> = []

  // Commands
  for (const cmdKey of Object.keys(module.commands) as Array<keyof M['commands'] & string>) {
    const channel = commandChannel(module.name, cmdKey)
    const handler = impl.commands[cmdKey] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
    disposers.push(() => ipcMain.removeHandler(channel))
  }

  // Events
  for (const evKey of Object.keys(module.events) as Array<keyof M['events'] & string>) {
    const channel = eventChannel(module.name, evKey)
    const wire = impl.events[evKey] as (emit: (payload: unknown) => void) => () => void
    const dispose = wire((payload) => broadcast(channel, payload))
    disposers.push(dispose)
  }

  return () => {
    for (const d of disposers) d()
  }
}
