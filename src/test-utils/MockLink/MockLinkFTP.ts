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
const FTP_OPCODE_ACK = 128
const FTP_OPCODE_NAK = 129

interface FTPPayload {
  seqNumber: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  offset: number
  data: Buffer
}

export class MockLinkFTP {
  private files = new Map<string, Buffer>()
  private sessions = new Map<number, { path: string; offset: number }>()
  private nextSession = 1
  private failureMode = FailureMode.NoFailure

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

    // ACK with session and file size
    const data = Buffer.alloc(5)
    data.writeUInt8(session, 0)
    data.writeUInt32LE(file.length, 1)
    this._sendAck(payload, data)
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
      this._sendNak(payload, 6) // EOF
      return
    }

    const chunkSize = Math.min(239, file.length - offset) // MAX_DATA_LENGTH
    const chunk = file.subarray(offset, offset + chunkSize)
    this._sendAck(payload, chunk)
  }

  private _handleCreateFile(payload: FTPPayload): void {
    const path = payload.data.toString('utf8').replace(/\0/g, '')
    const session = this.nextSession++
    this.sessions.set(session, { path, offset: 0 })
    this.files.set(path, Buffer.alloc(0))

    const data = Buffer.alloc(1)
    data.writeUInt8(session, 0)
    this._sendAck(payload, data)
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
      this._sendNak(payload, 6) // EOF (empty dir)
      return
    }

    const data = Buffer.from(entries.join('\0') + '\0')
    this._sendAck(payload, data)
  }

  private _handleTerminate(payload: FTPPayload): void {
    this.sessions.delete(payload.session)
    this._sendAck(payload, Buffer.alloc(0))
  }

  private _sendAck(req: FTPPayload, data: Buffer): void {
    // In a real implementation, this would be a FILE_TRANSFER_PROTOCOL message.
    // For testing, we emit a synthetic event.
    const response: FTPPayload = {
      seqNumber: req.seqNumber + 1,
      session: req.session,
      opcode: FTP_OPCODE_ACK,
      size: data.length,
      reqOpcode: req.opcode,
      offset: req.offset,
      data
    }
    // Emit as an event the FTP manager can listen to
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
      offset: req.offset,
      data
    }
    this.link.emit('ftpResponse', response)
  }
}
