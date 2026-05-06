import {
  commandBridgeKey,
  eventBridgeKey,
  type BridgeOf,
  type IpcModuleSpec,
  type ModuleBridge
} from '@shared/ipc/ipcModule'
import { rpcEventTopic } from '@shared/rpc'
import { allIpcModules } from '@shared/ipc/modules'
import { RpcTransport } from './RpcTransport'

export function bindRpcModule<M extends IpcModuleSpec>(
  module: M,
  transport: RpcTransport
): ModuleBridge<M> {
  const out: Record<string, unknown> = {}

  for (const cmdKey of Object.keys(module.commands)) {
    const methodName = commandBridgeKey(module.name, cmdKey)
    out[methodName] = (...args: unknown[]) => transport.command(module.name, cmdKey, args)
  }

  for (const evKey of Object.keys(module.events)) {
    const methodName = eventBridgeKey(module.name, evKey)
    const topic = rpcEventTopic(module.name, evKey)
    out[methodName] = (cb: (payload: unknown) => void) => transport.on(topic, cb)
  }

  return out as ModuleBridge<M>
}

export type BrowserRpcBridge = BridgeOf<typeof allIpcModules>
export type BrowserRpcBridgeWithLog = BrowserRpcBridge & {
  log: (level: 'info' | 'warn' | 'error' | 'debug', tag: string, message: string) => void
}

export function createBrowserRpcBridge(transport: RpcTransport): BrowserRpcBridgeWithLog {
  return Object.assign(
    {
      // rlog() already writes to the browser console. Server-side log forwarding
      // can become an RPC command later without changing the renderer surface.
      log: () => {}
    },
    ...allIpcModules.map((module) => bindRpcModule(module, transport))
  )
}
