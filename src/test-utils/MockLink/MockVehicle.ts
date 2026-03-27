import type { MockLink } from './MockLink'

/**
 * Simulates a vehicle sending telemetry at realistic rates.
 * HEARTBEAT at 1Hz, ATTITUDE at 10Hz, GPS at 4Hz.
 */
export class MockVehicle {
  private intervals: ReturnType<typeof setInterval>[] = []
  private link: MockLink
  private armed: boolean

  constructor(link: MockLink, armed = false) {
    this.link = link
    this.armed = armed
  }

  /** Start streaming all telemetry at realistic rates */
  startStreaming(
    options: {
      lat?: number
      lon?: number
      alt?: number
      armed?: boolean
    } = {}
  ): void {
    const { lat = 42.3898, lon = -71.1476, alt = 14, armed = this.armed } = options
    this.armed = armed

    // HEARTBEAT at 1Hz
    this.intervals.push(setInterval(() => this.link.injectHeartbeat(this.armed), 1000))

    // ATTITUDE at 10Hz
    this.intervals.push(
      setInterval(() => {
        const t = Date.now() / 1000
        this.link.injectAttitude(Math.sin(t * 0.7) * 0.05, Math.cos(t * 0.5) * 0.03, -1.5)
      }, 100)
    )

    // GLOBAL_POSITION_INT at 4Hz
    this.intervals.push(setInterval(() => this.link.injectPosition(lat, lon, alt, 270), 250))

    // SYS_STATUS at 1Hz
    this.intervals.push(setInterval(() => this.link.injectSysStatus(), 1000))

    // Send initial burst
    this.link.injectHeartbeat(this.armed)
    this.link.injectAttitude(0, 0, -1.5)
    this.link.injectPosition(lat, lon, alt, 270)
    this.link.injectSysStatus()
  }

  arm(): void {
    this.armed = true
  }

  disarm(): void {
    this.armed = false
  }

  stop(): void {
    for (const iv of this.intervals) clearInterval(iv)
    this.intervals = []
  }
}
