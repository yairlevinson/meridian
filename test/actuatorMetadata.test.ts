// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ActuatorMetadataManager } from '../src/main/actuators/ActuatorMetadataManager'

// Minimal mock for FTPManager
function createMockFtp(files: Record<string, Buffer>) {
  return {
    download: vi.fn(async (path: string) => {
      const buf = files[path]
      if (!buf) throw new Error(`FTP: file not found: ${path}`)
      return buf
    }),
    setSendFunction: vi.fn(),
    handleResponse: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn()
  }
}

// Minimal mock for MavCommandQueue
function createMockQueue() {
  return {
    sendCommand: vi.fn(async () => 0), // MavResult.ACCEPTED
    setLink: vi.fn(),
    handleCommandAck: vi.fn(),
    clear: vi.fn(),
    on: vi.fn(),
    emit: vi.fn()
  }
}

// Sample general metadata JSON (as PX4 serves it)
const GENERAL_METADATA = {
  version: 1,
  metadataTypes: [
    {
      type: 0,
      uri: 'mftp:///etc/extras/general.json.xz',
      fileCrc: 12345
    },
    {
      type: 5, // ACTUATORS
      uri: 'mftp:///etc/extras/actuators.json.xz',
      fileCrc: 67890
    }
  ]
}

// Sample actuator metadata JSON with custom function ranges
const ACTUATOR_METADATA = {
  version: 1,
  mixer: {
    'actuator-types': {
      motor: {
        'function-min': 101,
        'function-max': 112,
        'label-index-offset': 1,
        values: {
          min: 0,
          max: 1,
          reversible: false
        }
      },
      servo: {
        'function-min': 201,
        'function-max': 216,
        values: {
          min: -1,
          max: 1,
          reversible: false
        }
      }
    }
  }
}

// Non-standard actuator metadata with different function ranges
const CUSTOM_ACTUATOR_METADATA = {
  version: 1,
  mixer: {
    'actuator-types': {
      motor: {
        'function-min': 301,
        'function-max': 308,
        values: { min: 0, max: 1 }
      },
      servo: {
        'function-min': 401,
        'function-max': 408,
        values: { min: -1, max: 1 }
      }
    }
  }
}

describe('ActuatorMetadataManager', () => {
  let mgr: ActuatorMetadataManager

  beforeEach(() => {
    mgr = new ActuatorMetadataManager()
    mgr.setTarget(1)
  })

  describe('default function IDs', () => {
    it('returns PX4 default motor function IDs before metadata is loaded', () => {
      expect(mgr.motorFunction(1)).toBe(1101) // 1000 + 101
      expect(mgr.motorFunction(2)).toBe(1102)
      expect(mgr.motorFunction(4)).toBe(1104)
    })

    it('returns PX4 default servo function IDs before metadata is loaded', () => {
      expect(mgr.servoFunction(1)).toBe(1201) // 1000 + 201
      expect(mgr.servoFunction(2)).toBe(1202)
      expect(mgr.servoFunction(8)).toBe(1208)
    })
  })

  describe('handleComponentMetadata (397)', () => {
    it('fetches and parses actuator metadata via FTP', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json.xz': Buffer.from(JSON.stringify(GENERAL_METADATA)),
        '/etc/extras/actuators.json.xz': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      mgr.handleComponentMetadata({
        uri: 'mftp:///etc/extras/general.json.xz'
      })

      await loaded

      expect(mgr.fetched).toBe(true)
      expect(mgr.motorFunction(1)).toBe(1101)
    })
  })

  describe('handleComponentInformation (395)', () => {
    it('fetches and parses actuator metadata via FTP', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json.xz': Buffer.from(JSON.stringify(GENERAL_METADATA)),
        '/etc/extras/actuators.json.xz': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json.xz',
        generalMetadataFileCrc: 12345
      })

      await loaded

      expect(mgr.fetched).toBe(true)
      expect(mgr.motorFunction(1)).toBe(1101)
      expect(mgr.motorFunction(12)).toBe(1112) // functionMax is 112
      expect(mgr.servoFunction(1)).toBe(1201)
      expect(mgr.servoFunction(16)).toBe(1216)
      expect(mockFtp.download).toHaveBeenCalledTimes(2)
    })

    it('applies custom function ranges from vehicle metadata', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json.xz': Buffer.from(JSON.stringify(GENERAL_METADATA)),
        '/etc/extras/actuators.json.xz': Buffer.from(JSON.stringify(CUSTOM_ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json.xz',
        generalMetadataFileCrc: 12345
      })

      await loaded

      // Custom ranges: motor starts at 301, servo at 401
      expect(mgr.motorFunction(1)).toBe(1301) // 1000 + 301
      expect(mgr.motorFunction(4)).toBe(1304)
      expect(mgr.servoFunction(1)).toBe(1401) // 1000 + 401
      expect(mgr.servoFunction(4)).toBe(1404)
    })

    it('handles mftp:// URI with component ID prefix', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(
          JSON.stringify({
            ...GENERAL_METADATA,
            metadataTypes: [
              {
                type: 5,
                uri: 'mftp://[;comp=1]/etc/extras/actuators.json',
                fileCrc: 1
              }
            ]
          })
        ),
        '/etc/extras/actuators.json': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp://[;comp=1]/etc/extras/general.json',
        generalMetadataFileCrc: 0
      })

      await loaded

      expect(mockFtp.download).toHaveBeenCalledWith('/etc/extras/actuators.json')
      expect(mgr.fetched).toBe(true)
    })

    it('handles gzipped metadata files', async () => {
      const { gzipSync } = await import('zlib')
      const gzippedActuator = gzipSync(Buffer.from(JSON.stringify(ACTUATOR_METADATA)))

      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(
          JSON.stringify({
            ...GENERAL_METADATA,
            metadataTypes: [{ type: 5, uri: 'mftp:///etc/extras/actuators.json.gz', fileCrc: 1 }]
          })
        ),
        '/etc/extras/actuators.json.gz': gzippedActuator
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json',
        generalMetadataFileCrc: 0
      })

      await loaded
      expect(mgr.fetched).toBe(true)
      expect(mgr.motorFunction(1)).toBe(1101)
    })

    it('keeps defaults when FTP download fails', async () => {
      const mockFtp = createMockFtp({}) // no files → all downloads fail
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json',
        generalMetadataFileCrc: 0
      })

      // Wait for async to settle
      await new Promise((r) => setTimeout(r, 50))

      expect(mgr.fetched).toBe(false)
      // Defaults still work
      expect(mgr.motorFunction(1)).toBe(1101)
      expect(mgr.servoFunction(1)).toBe(1201)
    })

    it('keeps defaults when general metadata has no actuator type', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(
          JSON.stringify({
            version: 1,
            metadataTypes: [{ type: 0, uri: 'mftp:///etc/extras/params.json', fileCrc: 1 }]
          })
        )
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json',
        generalMetadataFileCrc: 0
      })

      await new Promise((r) => setTimeout(r, 50))

      expect(mgr.fetched).toBe(false)
      expect(mgr.motorFunction(1)).toBe(1101)
    })

    it('keeps defaults when URI is unsupported (http)', async () => {
      const mockFtp = createMockFtp({})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      mgr.handleComponentInformation({
        generalMetadataUri: 'https://example.com/metadata.json',
        generalMetadataFileCrc: 0
      })

      await new Promise((r) => setTimeout(r, 50))

      expect(mgr.fetched).toBe(false)
      expect(mockFtp.download).not.toHaveBeenCalled()
    })

    it('handles mftp:// URI without leading slash (PX4 v1.15 format)', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/component_general.json.xz': Buffer.from(
          JSON.stringify({
            version: 1,
            metadataTypes: [{ type: 5, uri: 'mftp://etc/extras/actuators.json', fileCrc: 1 }]
          })
        ),
        '/etc/extras/actuators.json': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      // URI without leading slash after mftp:// (as PX4 v1.15 sends)
      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp://etc/extras/component_general.json.xz',
        generalMetadataFileCrc: 0
      })

      await loaded
      expect(mockFtp.download).toHaveBeenCalledWith('/etc/extras/component_general.json.xz')
      expect(mockFtp.download).toHaveBeenCalledWith('/etc/extras/actuators.json')
      expect(mgr.fetched).toBe(true)
    })

    it('strips null bytes from URI string', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(
          JSON.stringify({
            version: 1,
            metadataTypes: [{ type: 5, uri: 'mftp:///etc/extras/actuators.json', fileCrc: 1 }]
          })
        ),
        '/etc/extras/actuators.json': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))

      // URI with trailing null bytes (common in MAVLink fixed-length strings)
      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json\0\0\0\0',
        generalMetadataFileCrc: 0
      })

      await loaded
      expect(mgr.fetched).toBe(true)
    })
  })

  describe('requestMetadata', () => {
    it('sends MAV_CMD_REQUEST_MESSAGE for COMPONENT_METADATA (397) first', async () => {
      const mockQueue = createMockQueue()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setCommandQueue(mockQueue as any)

      await mgr.requestMetadata()

      expect(mockQueue.sendCommand).toHaveBeenCalledWith(
        512, // MAV_CMD_REQUEST_MESSAGE
        1, // sysid
        1, // compid
        { p1: 397 }, // COMPONENT_METADATA msg ID
        { timeoutMs: 3000, maxRetries: 1 }
      )
    })

    it('falls back to COMPONENT_INFORMATION (395) if 397 fails', async () => {
      const mockQueue = createMockQueue()
      mockQueue.sendCommand = vi.fn(
        async (_cmd: number, _sys: number, _comp: number, params: { p1: number }) => {
          if (params.p1 === 397) throw new Error('unsupported')
          return 0
        }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setCommandQueue(mockQueue as any)

      await mgr.requestMetadata()

      // Calls: [148 AUTOPILOT_VERSION, 397 COMPONENT_METADATA, 395 COMPONENT_INFORMATION fallback]
      expect(mockQueue.sendCommand).toHaveBeenCalledTimes(3)
      expect(mockQueue.sendCommand).toHaveBeenNthCalledWith(
        3,
        512,
        1,
        1,
        { p1: 395 },
        { timeoutMs: 3000, maxRetries: 1 }
      )
    })

    it('does not request twice', async () => {
      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(JSON.stringify(GENERAL_METADATA)),
        '/etc/extras/actuators.json.xz': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      const mockQueue = createMockQueue()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setCommandQueue(mockQueue as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      // Simulate successful fetch
      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))
      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json',
        generalMetadataFileCrc: 0
      })
      await loaded

      // Try requesting again — should be no-op
      await mgr.requestMetadata()
      expect(mockQueue.sendCommand).not.toHaveBeenCalled()
    })
  })

  describe('metadata field on general json', () => {
    it('supports "metadata" key as alternative to "metadataTypes"', async () => {
      const generalWithMetadataKey = {
        version: 1,
        metadata: [{ type: 5, uri: 'mftp:///etc/extras/actuators.json', fileCrc: 1 }]
      }
      const mockFtp = createMockFtp({
        '/etc/extras/general.json': Buffer.from(JSON.stringify(generalWithMetadataKey)),
        '/etc/extras/actuators.json': Buffer.from(JSON.stringify(ACTUATOR_METADATA))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.setFtpManager(mockFtp as any)

      const loaded = new Promise<void>((resolve) => mgr.on('metadataLoaded', resolve))
      mgr.handleComponentInformation({
        generalMetadataUri: 'mftp:///etc/extras/general.json',
        generalMetadataFileCrc: 0
      })

      await loaded
      expect(mgr.fetched).toBe(true)
    })
  })
})
