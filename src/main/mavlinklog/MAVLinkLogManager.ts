import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Handles LOGGING_DATA and LOGGING_DATA_ACKED messages.
 * Writes ULog (.ulg) files to disk.
 */
export class MAVLinkLogManager extends EventEmitter {
  private buffer: Buffer[] = []
  private expectedSeq = 0
  private dropCount = 0
  private totalReceived = 0
  private outputDir: string
  private _active = false

  constructor(outputDir: string) {
    super()
    this.outputDir = outputDir
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }
  }

  get active(): boolean {
    return this._active
  }

  get stats(): { totalReceived: number; dropCount: number } {
    return { totalReceived: this.totalReceived, dropCount: this.dropCount }
  }

  /** Start logging session */
  start(): void {
    this.buffer = []
    this.expectedSeq = 0
    this.dropCount = 0
    this.totalReceived = 0
    this._active = true
    this.emit('started')
  }

  /** Handle LOGGING_DATA message (msgid=266) */
  handleLoggingData(data: {
    sequence: number
    length: number
    firstMessageOffset: number
    data: Buffer | Uint8Array
  }): void {
    if (!this._active) return

    this.totalReceived++

    // Check for sequence gaps
    if (this.totalReceived > 1 && data.sequence !== this.expectedSeq) {
      const gap =
        data.sequence > this.expectedSeq
          ? data.sequence - this.expectedSeq
          : 65536 - this.expectedSeq + data.sequence
      this.dropCount += gap
    }
    this.expectedSeq = (data.sequence + 1) & 0xffff

    // Store the data payload
    const payload = Buffer.from(data.data.buffer, data.data.byteOffset, data.length)
    this.buffer.push(payload)

    this.emit('data', {
      sequence: data.sequence,
      length: data.length,
      totalReceived: this.totalReceived,
      dropCount: this.dropCount
    })
  }

  /** Stop logging and write file to disk */
  stop(): string | null {
    if (!this._active || this.buffer.length === 0) {
      this._active = false
      return null
    }

    this._active = false
    const filename = `log_${Date.now()}.ulg`
    const filepath = join(this.outputDir, filename)
    const fullBuffer = Buffer.concat(this.buffer)
    writeFileSync(filepath, fullBuffer)

    this.emit('stopped', {
      filepath,
      totalBytes: fullBuffer.length,
      totalReceived: this.totalReceived,
      dropCount: this.dropCount
    })

    return filepath
  }

  /** Get the current buffer without stopping */
  getBuffer(): Buffer {
    return Buffer.concat(this.buffer)
  }
}
