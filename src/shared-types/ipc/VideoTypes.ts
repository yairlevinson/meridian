export enum VideoSourceType {
  Disabled = 'disabled',
  UDP_H264 = 'udp_h264',
  AV1 = 'av1',
  RTSP = 'rtsp',
  TCP_MPEGTS = 'tcp_mpegts'
}

export interface VideoStreamState {
  sourceType: VideoSourceType
  uri: string
  streaming: boolean
  recording: boolean
  wsPort: number | null
  wsUrl?: string | null
  error: string | null
  /** Which pipeline is active: ffmpeg (remux to fMP4 + MSE) or webcodecs (raw data + VideoDecoder) */
  pipeline: 'ffmpeg' | 'webcodecs'
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
