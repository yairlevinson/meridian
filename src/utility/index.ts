/**
 * Utility process entry point.
 *
 * Receives a MessagePort from the main process and serves an RPC surface.
 * Handlers run here — out of the main event loop — so things like the radar
 * simulator's setInterval and (eventually) MAVLink parsing don't compete with
 * window/IPC work for CPU.
 */
import type { MessagePortMain } from 'electron'
import type { UtilityRpcMessage } from '@shared/ipc/utilityRpc'
import type { RadarSettings } from '@shared/ipc/RadarTypes'
import { RadarManager } from './radar/RadarManager'
import { createLogger } from './logger'

const log = createLogger('utility')

type Handler = (...args: unknown[]) => unknown | Promise<unknown>

let radar: RadarManager | null = null
let activePort: MessagePortMain | null = null

function postEvent(channel: string, payload: unknown): void {
  activePort?.postMessage({ kind: 'evt', channel, payload } satisfies UtilityRpcMessage)
}

function ensureRadar(initial?: RadarSettings): RadarManager {
  if (!radar) {
    if (!initial) throw new Error('radar: initial settings required on first call')
    radar = new RadarManager(initial)
    radar.on('stateChanged', (state) => postEvent('radar:stateChanged', state))
  }
  return radar
}

const handlers: Record<string, Handler> = {
  echo: (msg: unknown) => msg,
  ping: () => 'pong',

  // --- Radar ---
  'radar:init': (settings) => {
    ensureRadar(settings as RadarSettings)
  },
  'radar:updateSettings': (patch) => {
    ensureRadar().updateSettings(patch as Partial<RadarSettings>)
  },
  'radar:enable': () => {
    ensureRadar().enable()
  },
  'radar:disable': () => {
    ensureRadar().disable()
  },
  'radar:setSimPosition': (lat, lon) => {
    ensureRadar().setSimulationPosition(lat as number, lon as number)
  },
  'radar:getState': () => ensureRadar().getState()
}

function install(port: MessagePortMain): void {
  activePort = port
  port.on('message', async (event) => {
    const msg = event.data as UtilityRpcMessage
    if (msg.kind !== 'req') return

    const handler = handlers[msg.method]
    if (!handler) {
      port.postMessage({
        kind: 'res',
        id: msg.id,
        ok: false,
        error: `Unknown method: ${msg.method}`
      } satisfies UtilityRpcMessage)
      return
    }

    try {
      const value = await handler(...msg.args)
      port.postMessage({ kind: 'res', id: msg.id, ok: true, value } satisfies UtilityRpcMessage)
    } catch (err) {
      port.postMessage({
        kind: 'res',
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      } satisfies UtilityRpcMessage)
    }
  })
  port.start()
  log.log('RPC port installed')
}

process.parentPort.once('message', (event) => {
  const [port] = event.ports
  if (!port) {
    log.error('no MessagePort received — exiting')
    process.exit(1)
  }
  install(port)
})

log.log('utility process booted')
