// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { LinkType, LinkConnectionStatus } from '../src/shared-types/ipc/LinkState'
import type { SerialLinkConfig } from '../src/shared-types/ipc/LinkState'

// --- Mock serialport ---
let mockPort: EventEmitter & {
  isOpen: boolean
  close: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
}

function createMockPort() {
  const port = new EventEmitter() as typeof mockPort
  port.isOpen = false
  port.close = vi.fn(() => {
    port.isOpen = false
    port.emit('close')
  })
  port.write = vi.fn()
  port.set = vi.fn((_opts: unknown, cb?: () => void) => cb?.())
  port.open = vi.fn((cb: (err?: Error) => void) => {
    setTimeout(() => {
      port.isOpen = true
      cb()
    }, 0)
  })
  return port
}

vi.mock('serialport', () => {
  const MockSerialPort = vi.fn(function () {
    return mockPort
  })
  return { SerialPort: MockSerialPort }
})

import { LinkManager } from '../src/main/links/LinkManager'
import { MavlinkProtocol } from '../src/main/mavlink/MavlinkProtocol'

describe('LinkManager with SerialLink', () => {
  let linkManager: LinkManager
  let protocol: MavlinkProtocol

  beforeEach(() => {
    mockPort = createMockPort()
    protocol = new MavlinkProtocol()
    linkManager = new LinkManager(protocol)
  })

  afterEach(() => {
    linkManager.disconnectAll()
    protocol.destroy()
    vi.restoreAllMocks()
  })

  it('creates a SerialLink for serial config', async () => {
    const config: SerialLinkConfig = {
      type: LinkType.Serial,
      name: 'Test Serial',
      portName: '/dev/ttyUSB0',
      baudRate: 115200
    }

    const link = await linkManager.createLink(config)
    expect(link.status).toBe(LinkConnectionStatus.Connected)
    expect(link.mavlinkChannel).toBeGreaterThanOrEqual(0)
    expect(link.config.type).toBe(LinkType.Serial)
  })

  it('tracks serial link in getAllStates', async () => {
    const config: SerialLinkConfig = {
      type: LinkType.Serial,
      name: 'Test Serial',
      portName: '/dev/ttyUSB0',
      baudRate: 57600
    }

    await linkManager.createLink(config)
    const states = linkManager.getAllStates()
    expect(states).toHaveLength(1)
    expect(states[0]!.config.type).toBe(LinkType.Serial)
    expect(states[0]!.status).toBe(LinkConnectionStatus.Connected)
  })

  it('tracks vehicle ids associated with a link', async () => {
    const config: SerialLinkConfig = {
      type: LinkType.Serial,
      name: 'Test Serial',
      portName: '/dev/ttyUSB0',
      baudRate: 57600
    }

    const link = await linkManager.createLink(config)
    linkManager.associateVehicle(link.id, 1)
    linkManager.associateVehicle(link.id, 2)
    linkManager.associateVehicle(link.id, 2)

    expect(linkManager.getAllStates()[0]!.vehicleIds).toEqual([1, 2])

    linkManager.disassociateVehicle(link.id, 1)
    expect(linkManager.getAllStates()[0]!.vehicleIds).toEqual([2])
  })

  it('disconnects serial link and frees channel', async () => {
    const config: SerialLinkConfig = {
      type: LinkType.Serial,
      name: 'Test Serial',
      portName: '/dev/ttyUSB0',
      baudRate: 115200
    }

    const link = await linkManager.createLink(config)
    const channelId = link.mavlinkChannel

    linkManager.disconnectLink(link.id)

    expect(linkManager.getAllStates()).toHaveLength(0)
    expect(protocol.getChannel(channelId)).toBeNull()
  })

  it('emits linkStateChanged on serial link creation', async () => {
    const stateChanged = vi.fn()
    linkManager.on('linkStateChanged', stateChanged)

    const config: SerialLinkConfig = {
      type: LinkType.Serial,
      name: 'Test Serial',
      portName: '/dev/ttyUSB0',
      baudRate: 115200
    }

    await linkManager.createLink(config)
    expect(stateChanged).toHaveBeenCalled()
  })
})
