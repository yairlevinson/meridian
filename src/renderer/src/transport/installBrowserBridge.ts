import { RpcTransport } from './RpcTransport'
import { createBrowserRpcBridge, type BrowserRpcBridgeWithLog } from './rpcBridge'
import { useConnectionStore } from '../store/connectionStore'
import { dispatchBrowserRpcStatus } from './browserRpcEvents'

const ACCESS_TOKEN_STORAGE_KEY = 'meridian-server-token'

export interface BrowserBridgeInstallOptions {
  serverUrl?: string
  realtimePath?: string
  accessToken?: string | null
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
  useConnectionStore.getState().setBrowserServerMode(serverUrl)
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

function appendAccessToken(wsUrl: string, accessToken: string | null | undefined): string {
  if (!accessToken) return wsUrl
  const url = new URL(wsUrl)
  url.searchParams.set('token', accessToken)
  return url.toString()
}

function readStoredAccessToken(): string | null {
  try {
    return window.localStorage?.getItem(ACCESS_TOKEN_STORAGE_KEY) || null
  } catch {
    return null
  }
}

function persistAccessToken(accessToken: string | null): void {
  if (!accessToken) return
  try {
    window.localStorage?.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken)
  } catch {
    // Ignore unavailable or full localStorage; explicit URL tokens still work.
  }
}

export function installBrowserRpcBridge(
  options: BrowserBridgeInstallOptions = {}
): BrowserBridgeInstallResult {
  const serverUrl = options.serverUrl ?? window.location.origin
  const pageToken = new URLSearchParams(window.location.search ?? '').get('token')
  const accessToken =
    options.accessToken ??
    import.meta.env.VITE_MERIDIAN_SERVER_TOKEN ??
    pageToken ??
    readStoredAccessToken()
  persistAccessToken(pageToken)
  markBrowserServerMode(serverUrl)

  const slot = bridgeSlot()
  if (slot.bridge && !options.replaceExisting) {
    const existing = slot.bridge
    return {
      bridge: existing,
      transport: null as unknown as RpcTransport,
      close: () => {}
    }
  }

  const transport = new RpcTransport({
    url: appendAccessToken(realtimeUrlFromServerUrl(serverUrl, options.realtimePath), accessToken),
    WebSocketCtor: options.WebSocketCtor
  })
  const disposeStatus = transport.onStatusChange((status) => {
    useConnectionStore.getState().setStatus(status)
    dispatchBrowserRpcStatus(status)
  })
  const bridge = createBrowserRpcBridge(transport, {
    videoWsUrl: appendAccessToken(videoWebSocketUrlFromServerUrl(serverUrl), accessToken)
  })
  slot.bridge = bridge

  return {
    bridge,
    transport,
    close: () => {
      disposeStatus()
      transport.close()
    }
  }
}
