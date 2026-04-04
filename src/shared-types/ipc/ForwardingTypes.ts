export interface ForwardingTargetConfig {
  id: string
  host: string
  port: number
  enabled: boolean
}

export interface ForwardingTargetState extends ForwardingTargetConfig {
  active: boolean
  bytesForwarded: number
  packetsForwarded: number
  bytesReceived: number
  packetsReceived: number
  lastActivityMs: number
}

export interface ForwardingState {
  enabled: boolean
  targets: ForwardingTargetState[]
}
