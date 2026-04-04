import type { MockLink } from './MockLink'
import { FailureMode } from './MockLink'

/**
 * Simulates FTP protocol responses for MockLink.
 * Supports download, upload, and list operations.
 */

// FTP opcodes
const FTP_OPCODE_TERMINATE = 1
const FTP_OPCODE_RESET = 2
const FTP_OPCODE_LIST_DIRECTORY = 3
const FTP_OPCODE_OPEN_FILE_RO = 4
const FTP_OPCODE_READ_FILE = 5
const FTP_OPCODE_CREATE_FILE = 6
const FTP_OPCODE_WRITE_FILE = 7
const FTP_OPCODE_BURST_READ_FILE = 15
const FTP_OPCODE_ACK = 128
const FTP_OPCODE_NAK = 129

const MAX_DATA_LENGTH = 239

interface FTPPayload {
  seqNumber: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  burstComplete: number
  offset: number
  data: Buffer
}

export class MockLinkFTP {
  private files = new Map<string, Buffer>()
  private sessions = new Map<number, { path: string; offset: number }>()
  private nextSession = 1
  private failureMode = FailureMode.NoFailure
  supportsBurst = true

  constructor(private link: MockLink) {}

  /** Set up a virtual file that can be downloaded */
  addFile(path: string, content: Buffer | string): void {
    this.files.set(path, typeof content === 'string' ? Buffer.from(content) : content)
  }

  /** Process an FTP request payload */
  handleFTPRequest(payload: FTPPayload): void {
    if (this.failureMode === FailureMode.NoResponse) return

    switch (payload.opcode) {
      case FTP_OPCODE_OPEN_FILE_RO:
        this._handleOpenFileRO(payload)
        break
      case FTP_OPCODE_READ_FILE:
        this._handleReadFile(payload)
        break
      case FTP_OPCODE_CREATE_FILE:
        this._handleCreateFile(payload)
        break
      case FTP_OPCODE_WRITE_FILE:
        this._handleWriteFile(payload)
        break
      case FTP_OPCODE_LIST_DIRECTORY:
        this._handleListDirectory(payload)
        break
      case FTP_OPCODE_BURST_READ_FILE:
        this._handleBurstReadFile(payload)
        break
      case FTP_OPCODE_TERMINATE:
        this._handleTerminate(payload)
        break
      case FTP_OPCODE_RESET:
        this.sessions.clear()
        this._sendAck(payload, Buffer.alloc(0))
        break
    }
  }

  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode
  }

  getFile(path: string): Buffer | undefined {
    return this.files.get(path)
  }

  private _handleOpenFileRO(payload: FTPPayload): void {
    const path = payload.data.toString('utf8').replace(/\0/g, '')
    const file = this.files.get(path)
    if (!file) {
      this._sendNak(payload, 2) // FileNotFound
      return
    }

    const session = this.nextSession++
    this.sessions.set(session, { path, offset: 0 })

    // ACK with file size in data, session in header (per MAVLink FTP protocol)
    const data = Buffer.alloc(4)
    data.writeUInt32LE(file.length, 0)
    const response: FTPPayload = {
      seqNumber: payload.seqNumber + 1,
      session, // new session ID in header
      opcode: FTP_OPCODE_ACK,
      size: data.length,
      reqOpcode: payload.opcode,
      burstComplete: 0,
      offset: payload.offset,
      data
    }
    this.link.emit('ftpResponse', response)
  }

  private _handleReadFile(payload: FTPPayload): void {
    const sess = this.sessions.get(payload.session)
    if (!sess) {
      this._sendNak(payload, 3) // InvalidSession
      return
    }

    const file = this.files.get(sess.path)
    if (!file) {
      this._sendNak(payload, 2)
      return
    }

    const offset = payload.offset
    if (offset >= file.length) {
      this._sendNak(payload, 5) // EOF
      return
    }

    const chunkSize = Math.min(MAX_DATA_LENGTH, file.length - offset)
    const chunk = file.subarray(offset, offset + chunkSize)
    this._sendAck(payload, chunk)
  }

  private _handleCreateFile(payload: FTPPayload): void {
    const path = payload.data.toString('utf8').replace(/\0/g, '')
    const session = this.nextSession++
    this.sessions.set(session, { path, offset: 0 })
    this.files.set(path, Buffer.alloc(0))

    // Session in header, not in data (per MAVLink FTP protocol)
    const response: FTPPayload = {
      seqNumber: payload.seqNumber + 1,
      session, // new session ID
      opcode: FTP_OPCODE_ACK,
      size: 0,
      reqOpcode: payload.opcode,
      burstComplete: 0,
      offset: payload.offset,
      data: Buffer.alloc(0)
    }
    this.link.emit('ftpResponse', response)
  }

  private _handleWriteFile(payload: FTPPayload): void {
    const sess = this.sessions.get(payload.session)
    if (!sess) {
      this._sendNak(payload, 3)
      return
    }

    const existing = this.files.get(sess.path) ?? Buffer.alloc(0)
    const needed = payload.offset + payload.data.length
    const newBuf = Buffer.alloc(Math.max(existing.length, needed))
    existing.copy(newBuf)
    payload.data.copy(newBuf, payload.offset)
    this.files.set(sess.path, newBuf)

    this._sendAck(payload, Buffer.alloc(0))
  }

  private _handleListDirectory(payload: FTPPayload): void {
    const dirPath = payload.data.toString('utf8').replace(/\0/g, '')
    const entries: string[] = []
    for (const [path] of this.files) {
      if (path.startsWith(dirPath)) {
        const relative = path.slice(dirPath.length)
        if (relative.startsWith('/')) {
          entries.push(`F${relative.slice(1)}\t${this.files.get(path)!.length}`)
        }
      }
    }

    if (entries.length === 0) {
      this._sendNak(payload, 5) // EOF (empty dir)
      return
    }

    const data = Buffer.from(entries.join('\0') + '\0')
    this._sendAck(payload, data)
  }

  private _handleBurstReadFile(payload: FTPPayload): void {
    if (!this.supportsBurst) {
      this._sendNak(payload, 6 /* UNKNOWN_COMMAND */)
      return
    }

    const sess = this.sessions.get(payload.session)
    if (!sess) {
      this._sendNak(payload, 3) // InvalidSession
      return
    }

    const file = this.files.get(sess.path)
    if (!file) {
      this._sendNak(payload, 2)
      return
    }

    let offset = payload.offset
    // Send multiple chunks in a burst (up to 10 chunks per burst, matching typical autopilot behavior)
    const maxChunksPerBurst = 10
    let chunksSent = 0
    let seqNum = payload.seqNumber + 1

    while (offset < file.length && chunksSent < maxChunksPerBurst) {
      const chunkSize = Math.min(MAX_DATA_LENGTH, file.length - offset)
      const chunk = file.subarray(offset, offset + chunkSize)
      const isLastInBurst =
        chunksSent === maxChunksPerBurst - 1 || offset + chunkSize >= file.length

      const response: FTPPayload = {
        seqNumber: seqNum++,
        session: payload.session,
        opcode: FTP_OPCODE_ACK,
        size: chunk.length,
        reqOpcode: FTP_OPCODE_BURST_READ_FILE,
        burstComplete: isLastInBurst ? 1 : 0,
        offset,
        data: chunk
      }
      this.link.emit('ftpResponse', response)

      offset += chunkSize
      chunksSent++
    }

    // If we've read the entire file, send EOF NAK
    if (offset >= file.length) {
      const eofResponse: FTPPayload = {
        seqNumber: seqNum,
        session: payload.session,
        opcode: FTP_OPCODE_NAK,
        size: 1,
        reqOpcode: FTP_OPCODE_BURST_READ_FILE,
        burstComplete: 0,
        offset,
        data: Buffer.from([5]) // EOF
      }
      this.link.emit('ftpResponse', eofResponse)
    }
  }

  private _handleTerminate(payload: FTPPayload): void {
    this.sessions.delete(payload.session)
    this._sendAck(payload, Buffer.alloc(0))
  }

  private _sendAck(req: FTPPayload, data: Buffer): void {
    const response: FTPPayload = {
      seqNumber: req.seqNumber + 1,
      session: req.session,
      opcode: FTP_OPCODE_ACK,
      size: data.length,
      reqOpcode: req.opcode,
      burstComplete: 0,
      offset: req.offset,
      data
    }
    this.link.emit('ftpResponse', response)
  }

  private _sendNak(req: FTPPayload, errorCode: number): void {
    const data = Buffer.from([errorCode])
    const response: FTPPayload = {
      seqNumber: req.seqNumber + 1,
      session: req.session,
      opcode: FTP_OPCODE_NAK,
      size: 1,
      reqOpcode: req.opcode,
      burstComplete: 0,
      offset: req.offset,
      data
    }
    this.link.emit('ftpResponse', response)
  }
}
