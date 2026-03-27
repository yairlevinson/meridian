export enum VideoSourceType {
  Disabled = 'disabled',
  UDP_H264 = 'udp_h264',
  UDP_H265 = 'udp_h265',
  RTSP = 'rtsp',
  TCP_MPEGTS = 'tcp_mpegts'
}

export interface VideoStreamState {
  sourceType: VideoSourceType
  uri: string
  streaming: boolean
  recording: boolean
  wsPort: number | null
  error: string | null
}

export interface VideoSettings {
  videoSource: VideoSourceType
  videoUdpPort: number
  videoRtspUrl: string
  videoTcpUrl: string
  videoStreamEnabled: boolean
  videoLowLatencyMode: boolean
  videoRecordingFormat: 'mkv' | 'mov' | 'mp4'
  videoGridLines: boolean
}
