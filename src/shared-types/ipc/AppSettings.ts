export interface AppSettings {
  // Map settings
  mapProvider: string
  offlineMapPath: string

  // Connection settings
  autoConnectUDP: boolean
  autoConnectUDPPort: number

  // Unit settings
  distanceUnits: 'meters' | 'feet'
  speedUnits: 'ms' | 'kmh' | 'mph' | 'knots'
  altitudeUnits: 'meters' | 'feet'

  // Display settings
  showPerfOverlay: boolean
  language: string
  theme: 'dark' | 'light'

  // Flight settings
  defaultTakeoffAltitude: number
  defaultRTLAltitude: number
  maxFlightAltitude: number

  // Battery settings
  batteryPercentWarning: number
  batteryPercentCritical: number

  // Logging
  saveFlightLogs: boolean
  flightLogDirectory: string

  // MAVLink stream rates (ArduPilot)
  streamRatePosition: number
  streamRateExtra1: number
  streamRateExtra2: number
  streamRateExtra3: number
  streamRateRCChannels: number
  streamRateRawSensors: number

  // Video streaming
  videoSource: 'disabled' | 'udp_h264' | 'udp_h265' | 'rtsp' | 'tcp_mpegts'
  videoUdpPort: number
  videoRtspUrl: string
  videoTcpUrl: string
  videoStreamEnabled: boolean
  videoLowLatencyMode: boolean
  videoRecordingFormat: 'mkv' | 'mov' | 'mp4'
  videoGridLines: boolean

  // MAVLink forwarding
  mavlinkForwardingEnabled: boolean
  mavlinkForwardingTargets: Array<{
    id: string
    host: string
    port: number
    enabled: boolean
  }>

  // Radar
  radarEnabled: boolean
  radarRadiusMeters: number
  radarSimulationEnabled: boolean
  radarSimulationFriendlyCount: number
  radarSimulationHostileCount: number
  radarSimulationLat: number
  radarSimulationLon: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  mapProvider: 'osm',
  offlineMapPath: '',
  autoConnectUDP: true,
  autoConnectUDPPort: 14550,
  distanceUnits: 'meters',
  speedUnits: 'ms',
  altitudeUnits: 'meters',
  showPerfOverlay: true,
  language: 'en',
  theme: 'dark',
  defaultTakeoffAltitude: 10,
  defaultRTLAltitude: 30,
  maxFlightAltitude: 120,
  batteryPercentWarning: 30,
  batteryPercentCritical: 15,
  saveFlightLogs: true,
  flightLogDirectory: '',
  streamRatePosition: 4,
  streamRateExtra1: 10,
  streamRateExtra2: 4,
  streamRateExtra3: 2,
  streamRateRCChannels: 2,
  streamRateRawSensors: 2,
  videoSource: 'disabled',
  videoUdpPort: 5600,
  videoRtspUrl: '',
  videoTcpUrl: '',
  videoStreamEnabled: true,
  videoLowLatencyMode: true,
  videoRecordingFormat: 'mp4',
  videoGridLines: false,
  mavlinkForwardingEnabled: false,
  mavlinkForwardingTargets: [],
  radarEnabled: false,
  radarRadiusMeters: 5000,
  radarSimulationEnabled: false,
  radarSimulationFriendlyCount: 4,
  radarSimulationHostileCount: 3,
  radarSimulationLat: 32.1,
  radarSimulationLon: 34.8
}
