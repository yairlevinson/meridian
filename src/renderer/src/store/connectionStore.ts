import { create } from 'zustand'
import type { RpcTransportStatus } from '../transport/RpcTransport'

interface MeridianConnectionGlobals {
  __MERIDIAN_BROWSER_SERVER__?: boolean
  __MERIDIAN_SERVER_URL__?: string
  __MERIDIAN_CONNECTION_STATUS__?: RpcTransportStatus
}

interface ConnectionStore {
  browserServerMode: boolean
  serverUrl: string | null
  status: RpcTransportStatus
  setBrowserServerMode: (serverUrl: string) => void
  setStatus: (status: RpcTransportStatus) => void
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  browserServerMode:
    typeof window !== 'undefined' &&
    Boolean((window as unknown as MeridianConnectionGlobals).__MERIDIAN_BROWSER_SERVER__),
  serverUrl:
    typeof window !== 'undefined'
      ? ((window as unknown as MeridianConnectionGlobals).__MERIDIAN_SERVER_URL__ ?? null)
      : null,
  status:
    typeof window !== 'undefined'
      ? ((window as unknown as MeridianConnectionGlobals).__MERIDIAN_CONNECTION_STATUS__ ??
        'disconnected')
      : 'disconnected',
  setBrowserServerMode: (serverUrl) => {
    if (typeof window !== 'undefined') {
      Object.assign(window as unknown as MeridianConnectionGlobals, {
        __MERIDIAN_BROWSER_SERVER__: true,
        __MERIDIAN_SERVER_URL__: serverUrl
      })
    }
    set({ browserServerMode: true, serverUrl })
  },
  setStatus: (status) => {
    if (typeof window !== 'undefined') {
      ;(window as unknown as MeridianConnectionGlobals).__MERIDIAN_CONNECTION_STATUS__ = status
    }
    set({ status })
  }
}))
