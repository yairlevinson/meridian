import {
  commandBridgeKey,
  eventBridgeKey,
  type BridgeOf,
  type IpcModuleSpec,
  type ModuleBridge
} from '@shared/ipc/ipcModule'
import { rpcEventTopic } from '@shared/rpc'
import { allIpcModules } from '@shared/ipc/modules'
import type { PopoutView } from '@shared/ipc/modules/popout'
import type { VideoStreamState } from '@shared/ipc/VideoTypes'
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

export interface BrowserRpcBridgeOptions {
  videoWsUrl?: string | null
}

interface BrowserVideoBridge {
  videoGetState: () => Promise<VideoStreamState | null>
  onVideoStateChanged: (cb: (state: VideoStreamState) => void) => () => void
}

interface BrowserPopoutBridge {
  popoutOpen: (view: PopoutView) => Promise<void>
  popoutClose: (view: PopoutView) => Promise<void>
  onPopoutClosed: (cb: (payload: { view: string }) => void) => () => void
}

function createBrowserPopoutBridge(): BrowserPopoutBridge {
  const popouts = new Map<PopoutView, Window>()
  const closePolls = new Map<PopoutView, number>()
  const listeners = new Set<(payload: { view: string }) => void>()

  const emitClosed = (view: PopoutView): void => {
    for (const listener of listeners) {
      listener({ view })
    }
  }

  const forgetPopout = (view: PopoutView, emit = true): void => {
    const poll = closePolls.get(view)
    if (poll !== undefined) window.clearInterval(poll)
    closePolls.delete(view)
    popouts.delete(view)
    if (emit) emitClosed(view)
  }

  return {
    popoutOpen: async (view) => {
      const existing = popouts.get(view)
      if (existing && !existing.closed) {
        existing.focus()
        return
      }

      const url = new URL(window.location.href)
      url.searchParams.set('popout', view)
      const child = window.open(
        url.toString(),
        `meridian-${view}-popout`,
        'popup,width=1200,height=800'
      )
      if (!child) return

      popouts.set(view, child)
      const poll = window.setInterval(() => {
        if (child.closed) forgetPopout(view)
      }, 500)
      closePolls.set(view, poll)
    },
    popoutClose: async (view) => {
      const child = popouts.get(view)
      if (child && !child.closed) child.close()
      forgetPopout(view)
    },
    onPopoutClosed: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}

function withVideoWebSocketUrl(
  state: VideoStreamState | null,
  videoWsUrl: string | null | undefined
): VideoStreamState | null {
  if (!state || !videoWsUrl) return state
  return { ...state, wsUrl: videoWsUrl }
}

function decorateBrowserVideoBridge(
  bridge: BrowserRpcBridgeWithLog,
  videoWsUrl: string | null | undefined
): void {
  if (!videoWsUrl) return

  const videoBridge = bridge as BrowserRpcBridgeWithLog & BrowserVideoBridge
  const videoGetState = videoBridge.videoGetState.bind(videoBridge)
  videoBridge.videoGetState = async () => withVideoWebSocketUrl(await videoGetState(), videoWsUrl)

  const onVideoStateChanged = videoBridge.onVideoStateChanged.bind(videoBridge)
  videoBridge.onVideoStateChanged = (cb) =>
    onVideoStateChanged((state) => {
      cb(withVideoWebSocketUrl(state, videoWsUrl)!)
    })
}

export function createBrowserRpcBridge(
  transport: RpcTransport,
  options: BrowserRpcBridgeOptions = {}
): BrowserRpcBridgeWithLog {
  const bridge = Object.assign(
    {
      // rlog() already writes to the browser console. Server-side log forwarding
      // can become an RPC command later without changing the renderer surface.
      log: () => {}
    },
    ...allIpcModules.map((module) => bindRpcModule(module, transport)),
    createBrowserPopoutBridge()
  )

  decorateBrowserVideoBridge(bridge, options.videoWsUrl)
  return bridge
}
