import { SerialPort } from 'serialport'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type SerialLinkConfig } from '@shared/ipc/LinkState'
import { createLogger } from '../logger'

const log = createLogger('SerialLink')

const AVAILABILITY_CHECK_MS = 1000

export class SerialLink extends LinkInterface {
  private port: SerialPort | null = null
  private portName: string
  private baudRate: number
  private dataBits: 5 | 6 | 7 | 8
  private stopBits: 1 | 2
  private parity: 'none' | 'even' | 'odd'
  private flowControl: boolean
  private availabilityTimer: ReturnType<typeof setInterval> | null = null
  private _errorEmitted = false

  constructor(id: string, config: SerialLinkConfig) {
    super(id, config)
    this.portName = config.portName
    this.baudRate = config.baudRate
    this.dataBits = config.dataBits ?? 8
    this.stopBits = config.stopBits ?? 1
    this.parity = config.parity ?? 'none'
    this.flowControl = config.flowControl ?? false
  }

  async connect(): Promise<void> {
    this._errorEmitted = false
    this.setStatus(LinkConnectionStatus.Connecting)

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.portName,
        baudRate: this.baudRate,
        dataBits: this.dataBits,
        stopBits: this.stopBits,
        parity: this.parity,
        rtscts: this.flowControl,
        autoOpen: false
      })

      this.port.on('data', (buf: Buffer) => this.emit('data', buf))

      this.port.on('error', (err: Error) => {
        if (!this._errorEmitted) {
          this._errorEmitted = true
          this.setStatus(LinkConnectionStatus.Error)
          this.emit('error', err)
        }
      })

      this.port.on('close', () => {
        this.stopAvailabilityCheck()
        this.setStatus(LinkConnectionStatus.Disconnected)
        this.emit('disconnected')
      })

      this.port.open((err) => {
        if (err) {
          this._errorEmitted = true
          this.setStatus(LinkConnectionStatus.Error)
          this.emit('error', err)
          this.port = null
          reject(err)
          return
        }

        // Set DTR high (resets some autopilot boards into flight mode)
        this.port!.set({ dtr: true }, () => {
          // ignore set errors — not all ports support DTR
        })

        this.setStatus(LinkConnectionStatus.Connected)
        this.emit('connected')
        this.startAvailabilityCheck()
        resolve()
      })
    })
  }

  disconnect(): void {
    this.stopAvailabilityCheck()
    if (this.port?.isOpen) {
      this.port.close()
    }
    this.port = null
  }

  writeBytes(buf: Buffer): void {
    if (this.port?.isOpen) {
      this.port.write(buf)
    }
  }

  private startAvailabilityCheck(): void {
    this.availabilityTimer = setInterval(async () => {
      try {
        const ports = await SerialPort.list()
        const stillExists = ports.some((p) => p.path === this.portName)
        if (!stillExists && this.port?.isOpen) {
          log.log(`Port ${this.portName} disappeared, disconnecting`)
          this.disconnect()
        }
      } catch {
        // ignore list errors
      }
    }, AVAILABILITY_CHECK_MS)
  }

  private stopAvailabilityCheck(): void {
    if (this.availabilityTimer) {
      clearInterval(this.availabilityTimer)
      this.availabilityTimer = null
    }
  }
}
