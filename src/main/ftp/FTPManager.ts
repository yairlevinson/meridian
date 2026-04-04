import { EventEmitter } from 'events'
import type { FtpDirectoryEntry } from '@shared/ipc/geo'
// FTP Opcodes
export const FTP_OPCODE = {
  NONE: 0,
  TERMINATE: 1,
  RESET: 2,
  LIST_DIRECTORY: 3,
  OPEN_FILE_RO: 4,
  READ_FILE: 5,
  CREATE_FILE: 6,
  WRITE_FILE: 7,
  REMOVE_FILE: 8,
  BURST_READ_FILE: 15,
  ACK: 128,
  NAK: 129
} as const

export const FTP_ERROR = {
  NONE: 0,
  FAIL: 1,
  FILE_NOT_FOUND: 2,
  INVALID_SESSION: 3,
  NO_SESSIONS: 4,
  EOF: 5,
  UNKNOWN_COMMAND: 6,
  FILE_EXISTS: 7,
  FILE_PROTECTED: 8
} as const

export interface FTPPayload {
  seqNumber: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  burstComplete: number
  offset: number
  data: Buffer
}

const MAX_DATA_LENGTH = 239
const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_RETRIES = 3

interface MissingBlock {
  offset: number
  length: number
}

/**
 * FTP protocol manager for MAVLink file transfers.
 * Supports download (with burst mode), upload, and directory listing.
 */
export class FTPManager extends EventEmitter {
  private seqNumber = 0
  private currentSession = 0
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pendingCallback: ((response: FTPPayload) => void) | null = null
  private burstHandler: ((response: FTPPayload) => void) | null = null
  private sendFn: ((payload: FTPPayload) => void) | null = null

  /** Set the function used to send FTP requests to the vehicle */
  setSendFunction(fn: (payload: FTPPayload) => void): void {
    this.sendFn = fn
  }

  /** Handle a response from the vehicle */
  handleResponse(response: FTPPayload): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.burstHandler) {
      this.burstHandler(response)
    } else {
      this.pendingCallback?.(response)
    }
  }

  /** Download a file from the vehicle. Attempts burst mode first, falls back to sequential. */
  async download(path: string): Promise<Buffer> {
    if (path.includes('..')) throw new Error('Path traversal not allowed')
    // Open file
    const openResp = await this._sendRequest({
      opcode: FTP_OPCODE.OPEN_FILE_RO,
      data: Buffer.from(path + '\0')
    })

    if (openResp.opcode === FTP_OPCODE.NAK) {
      throw new Error(`FTP: failed to open ${path}: error ${openResp.data[0]}`)
    }

    if (openResp.data.length < 4) {
      throw new Error(`FTP: open ${path}: response too short (${openResp.data.length} bytes)`)
    }
    const session = openResp.session
    const fileSize = openResp.data.readUInt32LE(0)

    let receivedData: Map<number, Buffer>
    let missingBlocks: MissingBlock[]

    if (fileSize === 0) {
      receivedData = new Map()
      missingBlocks = []
    } else {
      try {
        // Try burst mode first
        const result = await this._burstDownload(session, fileSize, path)
        receivedData = result.data
        missingBlocks = result.missingBlocks
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNKNOWN_COMMAND')) {
          // Vehicle doesn't support burst — fall back to sequential
          receivedData = new Map()
          missingBlocks = [{ offset: 0, length: fileSize }]
        } else {
          throw err
        }
      }
    }

    // Fill missing blocks with sequential READ_FILE
    for (const block of missingBlocks) {
      let offset = block.offset
      const end = block.offset + block.length
      while (offset < end) {
        const readResp = await this._sendRequest({
          opcode: FTP_OPCODE.READ_FILE,
          session,
          offset,
          size: MAX_DATA_LENGTH
        })

        if (readResp.opcode === FTP_OPCODE.NAK) {
          const errCode = readResp.data[0]
          if (errCode === FTP_ERROR.EOF) break
          throw new Error(`FTP: read error at offset ${offset}: error ${errCode}`)
        }

        receivedData.set(offset, Buffer.from(readResp.data))
        offset += readResp.data.length
        this.emit('progress', { path, bytesReceived: this._totalReceived(receivedData), totalBytes: fileSize })
      }
    }

    // Terminate session
    await this._sendRequest({ opcode: FTP_OPCODE.TERMINATE, session })

    return this._assembleFile(receivedData, fileSize)
  }

  /** Burst download: sends one BURST_READ_FILE request, vehicle responds with multiple ACKs */
  private _burstDownload(
    session: number,
    fileSize: number,
    path: string
  ): Promise<{ data: Map<number, Buffer>; missingBlocks: MissingBlock[] }> {
    return new Promise((resolve, reject) => {
      if (!this.sendFn) {
        reject(new Error('FTP: no send function'))
        return
      }

      const receivedData = new Map<number, Buffer>()
      let expectedOffset = 0
      const missingBlocks: MissingBlock[] = []
      let retryCount = 0

      const sendBurst = (firstRequest: boolean): void => {
        if (firstRequest) retryCount = 0

        const payload: FTPPayload = {
          seqNumber: ++this.seqNumber,
          session,
          opcode: FTP_OPCODE.BURST_READ_FILE,
          size: MAX_DATA_LENGTH,
          reqOpcode: 0,
          burstComplete: 0,
          offset: expectedOffset,
          data: Buffer.alloc(0)
        }

        this.sendFn!(payload)
        this.retryTimer = setTimeout(() => {
          retryCount++
          if (retryCount > DEFAULT_MAX_RETRIES) {
            cleanup()
            reject(new Error(`FTP: burst timeout after ${DEFAULT_MAX_RETRIES} retries`))
            return
          }
          sendBurst(false)
        }, DEFAULT_TIMEOUT_MS)
      }

      const cleanup = (): void => {
        this.burstHandler = null
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
          this.retryTimer = null
        }
      }

      this.burstHandler = (response: FTPPayload): void => {
        // Ignore responses for wrong request type
        if (response.reqOpcode !== FTP_OPCODE.BURST_READ_FILE) return
        if (response.session !== session) return

        // Clear timeout — we got a response
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
          this.retryTimer = null
        }

        if (response.opcode === FTP_OPCODE.ACK) {
          // Detect gaps: if response offset is ahead of expected, record missing block
          if (response.offset > expectedOffset) {
            missingBlocks.push({
              offset: expectedOffset,
              length: response.offset - expectedOffset
            })
          } else if (response.offset < expectedOffset) {
            // Already received this data, restart timeout and wait
            this.retryTimer = setTimeout(() => {
              retryCount++
              if (retryCount > DEFAULT_MAX_RETRIES) {
                cleanup()
                reject(new Error(`FTP: burst timeout after ${DEFAULT_MAX_RETRIES} retries`))
                return
              }
              sendBurst(false)
            }, DEFAULT_TIMEOUT_MS)
            return
          }

          // Store received chunk
          receivedData.set(response.offset, Buffer.from(response.data))
          expectedOffset = response.offset + response.data.length

          this.emit('progress', {
            path,
            bytesReceived: this._totalReceived(receivedData),
            totalBytes: fileSize
          })

          if (response.burstComplete) {
            // Current burst batch done, request next batch from expectedOffset
            sendBurst(true)
          } else {
            // More packets coming in this burst, just wait with timeout
            this.retryTimer = setTimeout(() => {
              retryCount++
              if (retryCount > DEFAULT_MAX_RETRIES) {
                cleanup()
                reject(new Error(`FTP: burst timeout after ${DEFAULT_MAX_RETRIES} retries`))
                return
              }
              sendBurst(false)
            }, DEFAULT_TIMEOUT_MS)
          }
        } else if (response.opcode === FTP_OPCODE.NAK) {
          const errCode = response.data[0]

          if (errCode === FTP_ERROR.EOF) {
            // Burst has gone through the whole file
            cleanup()
            resolve({ data: receivedData, missingBlocks })
          } else if (errCode === FTP_ERROR.UNKNOWN_COMMAND) {
            // Vehicle doesn't support burst mode
            cleanup()
            reject(new Error('FTP: UNKNOWN_COMMAND — burst not supported'))
          } else {
            cleanup()
            reject(new Error(`FTP: burst read error: ${errCode}`))
          }
        }
      }

      sendBurst(true)
    })
  }

  private _totalReceived(data: Map<number, Buffer>): number {
    let total = 0
    for (const chunk of data.values()) total += chunk.length
    return total
  }

  private _assembleFile(data: Map<number, Buffer>, fileSize: number): Buffer {
    if (data.size === 0) return Buffer.alloc(0)
    const result = Buffer.alloc(fileSize)
    for (const [offset, chunk] of data) {
      chunk.copy(result, offset)
    }
    return result
  }

  /** Upload a file to the vehicle */
  async upload(path: string, content: Buffer): Promise<void> {
    if (path.includes('..')) throw new Error('Path traversal not allowed')
    // Create file
    const createResp = await this._sendRequest({
      opcode: FTP_OPCODE.CREATE_FILE,
      data: Buffer.from(path + '\0')
    })

    if (createResp.opcode === FTP_OPCODE.NAK) {
      throw new Error(`FTP: failed to create ${path}: error ${createResp.data[0]}`)
    }

    const session = createResp.session
    let offset = 0

    while (offset < content.length) {
      const chunkSize = Math.min(MAX_DATA_LENGTH, content.length - offset)
      const chunk = content.subarray(offset, offset + chunkSize)

      const writeResp = await this._sendRequest({
        opcode: FTP_OPCODE.WRITE_FILE,
        session,
        offset,
        data: chunk
      })

      if (writeResp.opcode === FTP_OPCODE.NAK) {
        throw new Error(`FTP: write error at offset ${offset}: error ${writeResp.data[0]}`)
      }

      offset += chunkSize
      this.emit('progress', { path, bytesSent: offset, totalBytes: content.length })
    }

    // Terminate session
    await this._sendRequest({ opcode: FTP_OPCODE.TERMINATE, session })
  }

  /** List directory contents */
  async listDirectory(path: string): Promise<FtpDirectoryEntry[]> {
    if (path.includes('..')) throw new Error('Path traversal not allowed')
    const resp = await this._sendRequest({
      opcode: FTP_OPCODE.LIST_DIRECTORY,
      data: Buffer.from(path + '\0')
    })

    if (resp.opcode === FTP_OPCODE.NAK) {
      const errCode = resp.data[0]
      if (errCode === FTP_ERROR.EOF) return [] // empty directory
      throw new Error(`FTP: list error: ${errCode}`)
    }

    const entries = resp.data.toString('utf8').split('\0').filter(Boolean)
    return entries.map((entry) => {
      const isDir = entry.startsWith('D')
      const parts = entry.substring(1).split('\t')
      return {
        name: parts[0] ?? '',
        size: parseInt(parts[1] ?? '0', 10),
        isDir
      }
    })
  }

  destroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.pendingCallback = null
  }

  private _sendRequest(opts: {
    opcode: number
    session?: number
    offset?: number
    size?: number
    data?: Buffer
  }): Promise<FTPPayload> {
    return new Promise((resolve, reject) => {
      if (!this.sendFn) {
        reject(new Error('FTP: no send function'))
        return
      }

      this.retryCount = 0
      const payload: FTPPayload = {
        seqNumber: ++this.seqNumber,
        session: opts.session ?? this.currentSession,
        opcode: opts.opcode,
        size: opts.size ?? opts.data?.length ?? 0,
        reqOpcode: 0,
        burstComplete: 0,
        offset: opts.offset ?? 0,
        data: opts.data ?? Buffer.alloc(0)
      }

      this.pendingCallback = resolve

      const doSend = (): void => {
        this.sendFn!(payload)
        this.retryTimer = setTimeout(() => {
          this.retryCount++
          if (this.retryCount > DEFAULT_MAX_RETRIES) {
            this.pendingCallback = null
            reject(new Error(`FTP: timeout after ${DEFAULT_MAX_RETRIES} retries`))
            return
          }
          doSend()
        }, DEFAULT_TIMEOUT_MS)
      }

      doSend()
    })
  }
}
