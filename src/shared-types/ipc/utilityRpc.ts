/**
 * Minimal RPC protocol for main ⇄ utility-process MessagePort.
 *
 * Every request carries an `id`; the receiver responds with a message whose
 * `id` matches. Events are request-less messages that flow either direction.
 *
 * This is deliberately tiny — just enough to move the MAVLink stack into a
 * utility process. It is not a public API.
 */

export interface UtilityRpcRequest {
  kind: 'req'
  id: number
  method: string
  args: unknown[]
}

export interface UtilityRpcResponse {
  kind: 'res'
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

export interface UtilityRpcEvent {
  kind: 'evt'
  channel: string
  payload: unknown
}

export type UtilityRpcMessage = UtilityRpcRequest | UtilityRpcResponse | UtilityRpcEvent
