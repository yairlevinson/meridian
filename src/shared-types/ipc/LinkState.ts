/** Link transport types */
export enum LinkType {
  UDP = 'udp',
  TCP = 'tcp',
  Serial = 'serial',
  LogReplay = 'logReplay',
  Mock = 'mock'
}

/** Link connection status */
export enum LinkConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error'
}

/** Configuration for each link type */
export interface UdpLinkConfig {
  type: LinkType.UDP
  name: string
  listenPort: number
  targetHost?: string
  targetPort?: number
}

export interface TcpLinkConfig {
  type: LinkType.TCP
  name: string
  host: string
  port: number
}

export interface SerialLinkConfig {
  type: LinkType.Serial
  name: string
  portName: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
  flowControl?: boolean
}

export interface LogReplayLinkConfig {
  type: LinkType.LogReplay
  name: string
  filePath: string
  speedMultiplier: number
}

export interface MockLinkConfig {
  type: LinkType.Mock
  name: string
  firmwareType: number
  vehicleType: number
  sendStatusText: boolean
}

export type LinkConfig =
  | UdpLinkConfig
  | TcpLinkConfig
  | SerialLinkConfig
  | LogReplayLinkConfig
  | MockLinkConfig

/** Runtime state of a link */
export interface LinkState {
  id: string
  config: LinkConfig
  status: LinkConnectionStatus
  mavlinkChannel: number
  vehicleIds: number[]
  /** Telemetry stats */
  totalReceived: number
  totalLoss: number
  lossPercent: number
}
