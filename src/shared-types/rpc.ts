import type { EventMarker, IpcModuleSpec } from './ipc/ipcModule'

export interface RpcCommandMessage {
  id: string
  type: 'command'
  module: string
  command: string
  args: unknown[]
}

export interface RpcSubscribeMessage {
  type: 'subscribe'
  topics: string[]
}

export interface RpcUnsubscribeMessage {
  type: 'unsubscribe'
  topics: string[]
}

export type RpcClientMessage = RpcCommandMessage | RpcSubscribeMessage | RpcUnsubscribeMessage

export interface RpcSuccessReply {
  id: string
  type: 'reply'
  ok: true
  result: unknown
}

export interface RpcErrorReply {
  id: string
  type: 'reply'
  ok: false
  error: string
}

export interface RpcEventMessage {
  type: 'event'
  topic: string
  payload: unknown
}

export type RpcServerMessage = RpcSuccessReply | RpcErrorReply | RpcEventMessage

export function rpcEventTopic(moduleName: string, eventKey: string): string {
  return `${moduleName}:${eventKey}`
}

export function parseRpcClientMessage(raw: string): RpcClientMessage {
  const parsed = JSON.parse(raw) as Partial<RpcClientMessage>
  if (parsed.type === 'command') {
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
      throw new Error('RPC command message missing id')
    }
    if (typeof parsed.module !== 'string' || parsed.module.length === 0) {
      throw new Error('RPC command message missing module')
    }
    if (typeof parsed.command !== 'string' || parsed.command.length === 0) {
      throw new Error('RPC command message missing command')
    }
    if (!Array.isArray(parsed.args)) {
      throw new Error('RPC command message args must be an array')
    }
    return parsed as RpcCommandMessage
  }
  if (parsed.type === 'subscribe' || parsed.type === 'unsubscribe') {
    if (!Array.isArray(parsed.topics) || !parsed.topics.every((t) => typeof t === 'string')) {
      throw new Error(`RPC ${parsed.type} message topics must be a string array`)
    }
    return parsed as RpcSubscribeMessage | RpcUnsubscribeMessage
  }
  throw new Error('Unknown RPC message type')
}

export type RpcCommandImpls<M extends IpcModuleSpec> = {
  [K in keyof M['commands']]: (
    ...args: Parameters<M['commands'][K]>
  ) => ReturnType<M['commands'][K]> | Awaited<ReturnType<M['commands'][K]>>
}

export type RpcEventPayload<M extends IpcModuleSpec, K extends keyof M['events']> =
  M['events'][K] extends EventMarker<infer P> ? P : never

export interface RpcModuleImpl<M extends IpcModuleSpec> {
  commands: RpcCommandImpls<M>
}
