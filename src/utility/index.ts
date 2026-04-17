/**
 * Utility process entry point.
 *
 * Receives a MessagePort from the main process and serves a minimal RPC.
 * This is the Phase 1 skeleton for migrating the MAVLink stack off the
 * main process — only an `echo` method is wired for now to prove the
 * plumbing end-to-end.
 */
import type { MessagePortMain } from 'electron'
import type { UtilityRpcMessage } from '../shared-types/ipc/utilityRpc'

type Handler = (...args: unknown[]) => unknown | Promise<unknown>

const handlers: Record<string, Handler> = {
  echo: (msg: unknown) => msg,
  ping: () => 'pong'
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[utility] ${msg}`)
}

function install(port: MessagePortMain): void {
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
  log('RPC port installed')
}

process.parentPort.once('message', (event) => {
  const [port] = event.ports
  if (!port) {
    log('no MessagePort received — exiting')
    process.exit(1)
  }
  install(port)
})

log('utility process booted')
