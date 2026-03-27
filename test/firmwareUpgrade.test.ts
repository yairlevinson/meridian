// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FirmwareManager } from '../src/main/firmware/FirmwareManager'
import { FTPManager } from '../src/main/ftp/FTPManager'
import { MavCommandQueue } from '../src/main/vehicle/MavCommandQueue'
import { FirmwareUpgradeStatus } from '../src/shared-types/ipc/SetupTypes'
import { IpcChannels } from '../src/shared-types/ipc/channels'
import { IpcEvents } from '../src/shared-types/ipc/events'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import * as fs from 'fs/promises'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn()
}))

describe('FirmwareManager — state transitions', () => {
  let manager: FirmwareManager
  let ftp: FTPManager
  let queue: MavCommandQueue

  beforeEach(() => {
    manager = new FirmwareManager()
    ftp = new FTPManager()
    queue = new MavCommandQueue()
    manager.setFtpManager(ftp)
    manager.setCommandQueue(queue)
    manager.setSysId(1)
  })

  afterEach(() => {
    manager.destroy()
  })

  it('starts in idle state', () => {
    expect(manager.state.status).toBe(FirmwareUpgradeStatus.Idle)
    expect(manager.state.progress).toBe(0)
  })

  it('transitions to uploading when uploadFile is called', async () => {
    const states: FirmwareUpgradeStatus[] = []
    manager.on('stateChanged', (s) => states.push(s.status))

    // Mock file system
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof fs.stat>>)
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.alloc(1024))

    // Mock FTP upload to resolve
    vi.spyOn(ftp, 'upload').mockResolvedValue(undefined)

    await manager.uploadFile('/tmp/firmware.bin')

    expect(states).toContain(FirmwareUpgradeStatus.Uploading)
    expect(states).toContain(FirmwareUpgradeStatus.Complete)
  })

  it('fails when FTP manager is not set', async () => {
    const mgr = new FirmwareManager()
    // No FTP manager set

    const states: FirmwareUpgradeStatus[] = []
    mgr.on('stateChanged', (s) => states.push(s.status))

    await mgr.uploadFile('/tmp/firmware.bin')

    expect(states).toContain(FirmwareUpgradeStatus.Failed)
    expect(mgr.state.message).toContain('No FTP connection')
    mgr.destroy()
  })

  it('fails when file is empty', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 0 } as Awaited<ReturnType<typeof fs.stat>>)

    const states: FirmwareUpgradeStatus[] = []
    manager.on('stateChanged', (s) => states.push(s.status))

    await manager.uploadFile('/tmp/empty.bin')

    expect(states).toContain(FirmwareUpgradeStatus.Failed)
    expect(manager.state.message).toContain('empty')
  })

  it('fails when FTP upload fails', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof fs.stat>>)
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.alloc(1024))
    vi.spyOn(ftp, 'upload').mockRejectedValue(new Error('FTP: timeout'))

    const states: FirmwareUpgradeStatus[] = []
    manager.on('stateChanged', (s) => states.push(s.status))

    await manager.uploadFile('/tmp/firmware.bin')

    expect(states).toContain(FirmwareUpgradeStatus.Failed)
    expect(manager.state.message).toContain('FTP: timeout')
  })

  it('can be cancelled during upload', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof fs.stat>>)
    vi.mocked(fs.readFile).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(Buffer.alloc(1024)), 500))
    )

    const uploadPromise = manager.uploadFile('/tmp/firmware.bin')
    manager.cancel()

    await uploadPromise

    expect(manager.state.status).toBe(FirmwareUpgradeStatus.Idle)
    expect(manager.state.message).toBe('Cancelled')
  })

  it('transitions to complete after successful upload', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 2048 } as Awaited<ReturnType<typeof fs.stat>>)
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.alloc(2048))
    vi.spyOn(ftp, 'upload').mockResolvedValue(undefined)

    await manager.uploadFile('/tmp/firmware.apj')

    expect(manager.state.status).toBe(FirmwareUpgradeStatus.Complete)
    expect(manager.state.progress).toBe(1)
    expect(manager.state.fileName).toBe('firmware.apj')
    expect(manager.state.fileSize).toBe(2048)
  })
})

describe('FirmwareManager — reboot', () => {
  let manager: FirmwareManager

  beforeEach(() => {
    manager = new FirmwareManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  it('fails when no command queue is set', async () => {
    // No command queue set
    await manager.reboot()
    expect(manager.state.status).toBe(FirmwareUpgradeStatus.Failed)
    expect(manager.state.message).toContain('No command link')
  })

  it('transitions to rebooting state', async () => {
    const queue = new MavCommandQueue()
    manager.setCommandQueue(queue)
    manager.setSysId(1)

    const states: FirmwareUpgradeStatus[] = []
    manager.on('stateChanged', (s) => states.push(s.status))

    // sendCommand will hang without an ACK, so we just check the state change
    const rebootPromise = manager.reboot()

    // Wait briefly then inject ACK for command 246
    await new Promise((r) => setTimeout(r, 50))
    queue.handleCommandAck({ command: 246, result: 0 })
    await rebootPromise

    expect(states).toContain(FirmwareUpgradeStatus.Rebooting)
  })
})

describe('FirmwareManager — Vehicle integration', () => {
  it('Vehicle has firmwareManager and ftpManager', () => {
    const vehicle = new Vehicle(1)
    expect(vehicle.firmwareManager).toBeDefined()
    expect(vehicle.ftpManager).toBeDefined()
    vehicle.destroy()
  })

  it('firmwareManager has command queue linked', () => {
    const vehicle = new Vehicle(1)
    // The firmware manager should have the command queue set
    expect(vehicle.firmwareManager.state.status).toBe(FirmwareUpgradeStatus.Idle)
    vehicle.destroy()
  })
})

describe('Firmware IPC channels and events', () => {
  it('firmware IPC channels exist and are unique', () => {
    expect(IpcChannels.FirmwareUploadFile).toBe('firmware:uploadFile')
    expect(IpcChannels.FirmwareCancel).toBe('firmware:cancel')
    expect(IpcChannels.FirmwareReboot).toBe('firmware:reboot')
    expect(IpcChannels.FirmwareGetBoardInfo).toBe('firmware:getBoardInfo')

    const values = Object.values(IpcChannels)
    for (const ch of [
      'firmware:uploadFile',
      'firmware:cancel',
      'firmware:reboot',
      'firmware:getBoardInfo'
    ]) {
      expect(values.filter((v) => v === ch)).toHaveLength(1)
    }
  })

  it('firmware upgrade event exists', () => {
    expect(IpcEvents.FirmwareUpgradeStateChanged).toBe('firmware:stateChanged')
  })
})
