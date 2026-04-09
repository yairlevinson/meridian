// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { IpcEvents } from '../src/shared-types/ipc/events'
import { IpcChannels } from '../src/shared-types/ipc/channels'

// ── Mock electron ipcMain + BrowserWindow ───────────────────────
const registeredHandlers = new Map<string, (...args: any[]) => any>()

// The mock windows list — tests manipulate this to control broadcast targets
let mockWindows: { webContents: ReturnType<typeof createMockWebContents> }[] = []

const registeredListeners = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      registeredHandlers.delete(channel)
    },
    on: (channel: string, handler: (...args: any[]) => any) => {
      registeredListeners.set(channel, handler)
    },
    removeListener: (channel: string) => {
      registeredListeners.delete(channel)
    }
  },
  BrowserWindow: {
    getAllWindows: () => mockWindows
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn()
  }
}))

// ── Minimal mock WebContents ────────────────────────────────────
function createMockWebContents() {
  const sent: { channel: string; args: any[] }[] = []
  return {
    sent,
    isDestroyed: () => false,
    send: (channel: string, ...args: any[]) => {
      sent.push({ channel, args })
    }
  }
}

// ── Minimal mock Vehicle ────────────────────────────────────────
function createMockVehicle(sysid: number, delta: Record<string, any> = {}, dirty = true) {
  return {
    sysid,
    hasDirty: vi.fn(() => dirty),
    getDelta: vi.fn(() => ({ ...delta }))
  }
}

// ── Minimal mock VehicleManager ─────────────────────────────────
class MockVehicleManager extends EventEmitter {
  private vehicles: ReturnType<typeof createMockVehicle>[] = []

  addMockVehicle(v: ReturnType<typeof createMockVehicle>) {
    this.vehicles.push(v)
  }

  getAllVehicles() {
    return this.vehicles
  }

  get vehicleCount() {
    return this.vehicles.length
  }

  getVehicle(sysid: number) {
    return this.vehicles.find((v) => v.sysid === sysid)
  }
}

// Must import after mocking electron
import { startIpcBridge } from '../src/main/ipcBridge'

describe('ipcBridge', () => {
  let vm: MockVehicleManager
  let wc: ReturnType<typeof createMockWebContents>
  let cleanup: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    registeredHandlers.clear()
    vm = new MockVehicleManager()
    wc = createMockWebContents()
    mockWindows = [{ webContents: wc as any }]
    cleanup = startIpcBridge(vm as any)
  })

  afterEach(() => {
    cleanup()
    mockWindows = []
    vi.useRealTimers()
  })

  it('sends vehicle deltas to webContents when dirty', () => {
    const vehicle = createMockVehicle(1, { core: { armed: true, sysid: 1 } })
    vm.addMockVehicle(vehicle)

    // Advance past one tick (33ms)
    vi.advanceTimersByTime(34)

    const deltaMsgs = wc.sent.filter((s) => s.channel === IpcEvents.VehicleDelta)
    expect(deltaMsgs).toHaveLength(1)
    expect(deltaMsgs[0].args[0].vehicleId).toBe(1)
    expect(deltaMsgs[0].args[0].delta.core.armed).toBe(true)
  })

  it('skips sending when vehicle has no dirty state', () => {
    const vehicle = createMockVehicle(1, {}, false) // not dirty
    vm.addMockVehicle(vehicle)

    vi.advanceTimersByTime(34)

    const deltaMsgs = wc.sent.filter((s) => s.channel === IpcEvents.VehicleDelta)
    expect(deltaMsgs).toHaveLength(0)
    expect(vehicle.getDelta).not.toHaveBeenCalled()
  })

  it('forwards vehicleAdded events to webContents', () => {
    vm.emit('vehicleAdded', 42)

    const addedMsgs = wc.sent.filter((s) => s.channel === IpcEvents.VehicleAdded)
    expect(addedMsgs).toHaveLength(1)
    expect(addedMsgs[0].args[0]).toEqual({ vehicleId: 42 })
  })

  it('forwards vehicleRemoved events to webContents', () => {
    vm.emit('vehicleRemoved', 7)

    const removedMsgs = wc.sent.filter((s) => s.channel === IpcEvents.VehicleRemoved)
    expect(removedMsgs).toHaveLength(1)
    expect(removedMsgs[0].args[0]).toEqual({ vehicleId: 7 })
  })

  it('does not send when no windows are open', () => {
    mockWindows = []

    const vehicle = createMockVehicle(1, { core: { armed: true } })
    vm.addMockVehicle(vehicle)

    vi.advanceTimersByTime(34)
    expect(wc.sent).toHaveLength(0)
  })

  it('does not send when webContents is destroyed', () => {
    const destroyedWc = {
      isDestroyed: () => true,
      send: vi.fn()
    }
    mockWindows = [{ webContents: destroyedWc as any }]

    const vehicle = createMockVehicle(1, { core: { armed: true } })
    vm.addMockVehicle(vehicle)

    vi.advanceTimersByTime(34)
    expect(destroyedWc.send).not.toHaveBeenCalled()
  })

  it('registers IPC handlers on startup', () => {
    expect(registeredHandlers.has(IpcChannels.VehicleArm)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.VehicleDisarm)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.VehicleGuidedTakeoff)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.ParametersGetAll)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.MissionLoad)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.ActuatorMotorTest)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.ActuatorServoTest)).toBe(true)
  })

  it('cleans up IPC handlers and interval on cleanup', () => {
    // Handlers exist before cleanup
    expect(registeredHandlers.size).toBeGreaterThan(0)

    cleanup()

    // Handlers removed after cleanup
    expect(registeredHandlers.has(IpcChannels.VehicleArm)).toBe(false)
    expect(registeredHandlers.has(IpcChannels.VehicleDisarm)).toBe(false)

    // Interval no longer fires (add vehicle, advance timer, nothing sent)
    const vehicle = createMockVehicle(1, { core: { armed: true } })
    vm.addMockVehicle(vehicle)
    vi.advanceTimersByTime(100)
    expect(wc.sent).toHaveLength(0)

    // Prevent double-cleanup in afterEach
    cleanup = () => {}
  })

  it('sends deltas for multiple vehicles in a single tick', () => {
    vm.addMockVehicle(createMockVehicle(1, { core: { armed: true, sysid: 1 } }))
    vm.addMockVehicle(createMockVehicle(2, { attitude: { roll: 0.5 } }))

    vi.advanceTimersByTime(34)

    const deltaMsgs = wc.sent.filter((s) => s.channel === IpcEvents.VehicleDelta)
    expect(deltaMsgs).toHaveLength(2)
    const vehicleIds = deltaMsgs.map((m) => m.args[0].vehicleId).sort()
    expect(vehicleIds).toEqual([1, 2])
  })
})
