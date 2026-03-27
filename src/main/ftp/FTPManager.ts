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
  offset: number
  data: Buffer
}

const MAX_DATA_LENGTH = 239
const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_RETRIES = 3

/**
 * FTP protocol manager for MAVLink file transfers.
 * Supports download, upload, and directory listing.
 */
export class FTPManager extends EventEmitter {
  private seqNumber = 0
  private currentSession = 0
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pendingCallback: ((response: FTPPayload) => void) | null = null
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
    this.pendingCallback?.(response)
  }

  /** Download a file from the vehicle */
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

    const session = openResp.data[0]!
    const fileSize = openResp.data.readUInt32LE(1)
    const chunks: Buffer[] = []
    let offset = 0

    // Read file in chunks
    while (offset < fileSize) {
      const readResp = await this._sendRequest({
        opcode: FTP_OPCODE.READ_FILE,
        session,
        offset
      })

      if (readResp.opcode === FTP_OPCODE.NAK) {
        const errCode = readResp.data[0]
        if (errCode === FTP_ERROR.EOF) break
        throw new Error(`FTP: read error at offset ${offset}: error ${errCode}`)
      }

      chunks.push(Buffer.from(readResp.data))
      offset += readResp.data.length
      this.emit('progress', { path, bytesReceived: offset, totalBytes: fileSize })
    }

    // Terminate session
    await this._sendRequest({ opcode: FTP_OPCODE.TERMINATE, session })

    return Buffer.concat(chunks)
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

    const session = createResp.data[0]!
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
        size: opts.data?.length ?? 0,
        reqOpcode: 0,
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
