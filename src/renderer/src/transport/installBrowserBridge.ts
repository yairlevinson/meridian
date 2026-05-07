import { RpcTransport } from './RpcTransport'
import { createBrowserRpcBridge, type BrowserRpcBridgeWithLog } from './rpcBridge'

export interface BrowserBridgeInstallOptions {
  serverUrl?: string
  realtimePath?: string
  replaceExisting?: boolean
  WebSocketCtor?: typeof WebSocket
}

export interface BrowserBridgeInstallResult {
  bridge: BrowserRpcBridgeWithLog
  transport: RpcTransport | null
  close: () => void
}

function bridgeSlot(): { bridge?: BrowserRpcBridgeWithLog } {
  return window as unknown as { bridge?: BrowserRpcBridgeWithLog }
}

function markBrowserServerMode(serverUrl: string): void {
  Object.assign(window as unknown as Record<string, unknown>, {
    __MERIDIAN_BROWSER_SERVER__: true,
    __MERIDIAN_SERVER_URL__: serverUrl
  })
}

export function realtimeUrlFromServerUrl(serverUrl: string, realtimePath = '/realtime'): string {
  const url = new URL(serverUrl)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported Meridian server protocol: ${url.protocol}`)
  }
  url.pathname = realtimePath.startsWith('/') ? realtimePath : `/${realtimePath}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function videoWebSocketUrlFromServerUrl(
  serverUrl: string,
  videoPath = '/video/live'
): string {
  const url = new URL(serverUrl)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported Meridian server protocol: ${url.protocol}`)
  }
  url.pathname = videoPath.startsWith('/') ? videoPath : `/${videoPath}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function installBrowserRpcBridge(
  options: BrowserBridgeInstallOptions = {}
): BrowserBridgeInstallResult {
  const slot = bridgeSlot()
  if (slot.bridge && !options.replaceExisting) {
    const existing = slot.bridge
    return {
      bridge: existing,
      transport: null as unknown as RpcTransport,
      close: () => {}
    }
  }

  const serverUrl = options.serverUrl ?? window.location.origin
  markBrowserServerMode(serverUrl)
  const transport = new RpcTransport({
    url: realtimeUrlFromServerUrl(serverUrl, options.realtimePath),
    WebSocketCtor: options.WebSocketCtor
  })
  const bridge = createBrowserRpcBridge(transport, {
    videoWsUrl: videoWebSocketUrlFromServerUrl(serverUrl)
  })
  slot.bridge = bridge

  return {
    bridge,
    transport,
    close: () => transport.close()
  }
}
