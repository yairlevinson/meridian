import type { RpcTransportStatus } from './RpcTransport'

export const MERIDIAN_RPC_STATUS_EVENT = 'meridian:rpc-status'
export const MERIDIAN_RPC_CONNECTED_EVENT = 'meridian:rpc-connected'

export function dispatchBrowserRpcStatus(status: RpcTransportStatus): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MERIDIAN_RPC_STATUS_EVENT, { detail: status }))
  if (status === 'connected') {
    window.dispatchEvent(new Event(MERIDIAN_RPC_CONNECTED_EVENT))
  }
}

export function onBrowserRpcConnected(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(MERIDIAN_RPC_CONNECTED_EVENT, handler)
  return () => {
    window.removeEventListener(MERIDIAN_RPC_CONNECTED_EVENT, handler)
  }
}
