// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlanManager } from '../src/main/mission/PlanManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { bindForTest } from '../src/test-utils/bindForTest'
import {
  MissionProtocolState,
  MissionError,
  type MissionItem
} from '../src/shared-types/ipc/MissionTypes'

function makeItem(seq: number, alt = 50): MissionItem {
  return {
    seq,
    frame: 3,
    command: 16,
    current: seq === 0,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(42.389 * 1e7),
    y: Math.round(-71.147 * 1e7),
    z: alt,
    missionType: 0
  }
}

describe('PlanManager — mission ACK error codes', () => {
  let pm: PlanManager
  let link: MockLink

  beforeEach(() => {
    pm = new PlanManager()
    link = new MockLink()
    bindForTest(pm, link)
  })

  afterEach(() => pm.destroy())

  it('handleMissionAck with Denied (3) emits error and sets Error state', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionAck(MissionError.Denied)

    expect(error).toHaveBeenCalledWith(MissionError.Denied)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('handleMissionAck with NoSpace (4) emits error', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionAck(MissionError.NoSpace)

    expect(error).toHaveBeenCalledWith(MissionError.NoSpace)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('handleMissionAck with InvalidParam (5) emits error', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionAck(MissionError.InvalidParam)

    expect(error).toHaveBeenCalledWith(MissionError.InvalidParam)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('handleMissionAck with Unsupported (6) emits error', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionAck(MissionError.Unsupported)

    expect(error).toHaveBeenCalledWith(MissionError.Unsupported)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('handleMissionAck with VehicleError (7) emits error', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionAck(MissionError.VehicleError)

    expect(error).toHaveBeenCalledWith(MissionError.VehicleError)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('handleMissionAck with ACCEPTED (0) during write emits writeComplete', () => {
    const complete = vi.fn()
    const error = vi.fn()
    pm.on('writeComplete', complete)
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    pm.handleMissionRequest(0)
    pm.handleMissionAck(0)

    expect(complete).toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('error ACK during download transitions to Error state', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.loadFromVehicle()
    pm.handleMissionCount(2)
    // Simulate receiving first item then getting error ACK
    pm.handleMissionItemInt(makeItem(0))
    // Vehicle sends error ACK instead of second item
    pm.handleMissionAck(MissionError.VehicleError)

    expect(error).toHaveBeenCalledWith(MissionError.VehicleError)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })
})

describe('PlanManager — invalid sequence during upload', () => {
  let pm: PlanManager
  let link: MockLink

  beforeEach(() => {
    pm = new PlanManager()
    link = new MockLink()
    bindForTest(pm, link)
  })

  afterEach(() => pm.destroy())

  it('errors on out-of-bounds sequence request', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.writeToVehicle([makeItem(0)])
    // Vehicle requests seq=5 which doesn't exist
    pm.handleMissionRequest(5)

    expect(error).toHaveBeenCalledWith(MissionError.InvalidSequence)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })
})

describe('PlanManager — timeout and retry', () => {
  let pm: PlanManager
  let link: MockLink

  beforeEach(() => {
    vi.useFakeTimers()
    pm = new PlanManager()
    link = new MockLink()
    bindForTest(pm, link)
  })

  afterEach(() => {
    pm.destroy()
    vi.useRealTimers()
  })

  it('retries MISSION_REQUEST_LIST on timeout during ReadingCount', () => {
    pm.loadFromVehicle()
    expect(link.sentBuffers).toHaveLength(1)

    // Advance past ACK_TIMEOUT_MS (1500ms)
    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers).toHaveLength(2) // first send + 1 retry

    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers).toHaveLength(3) // + another retry
  })

  it('retries MISSION_REQUEST_INT on timeout during ReadingItems', () => {
    pm.loadFromVehicle()
    pm.handleMissionCount(2)
    const sentAfterCount = link.sentBuffers.length

    // Timeout on first item request
    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers.length).toBe(sentAfterCount + 1) // retry item request
  })

  it('retries MISSION_COUNT on timeout during WritingCount', () => {
    pm.writeToVehicle([makeItem(0)])
    expect(link.sentBuffers).toHaveLength(1)

    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers).toHaveLength(2) // retry count
  })

  it('retries MISSION_ITEM_INT on timeout during WritingItems', () => {
    pm.writeToVehicle([makeItem(0), makeItem(1)])
    pm.handleMissionRequest(0) // vehicle requests item 0
    const sentAfterItem = link.sentBuffers.length

    vi.advanceTimersByTime(1500)
    expect(link.sentBuffers.length).toBe(sentAfterItem + 1) // retry item
  })

  it('errors with Timeout after MAX_RETRY_COUNT (5) exhausted and download retries', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.loadFromVehicle()

    // 4 download attempts total (1 initial + 3 retries)
    // Each attempt: 6 ack timeouts (initial + 5 retries), then 2s retry delay
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(1500)
      }
      if (attempt < 3) {
        // Advance past download retry delay
        vi.advanceTimersByTime(2000)
      }
    }

    expect(error).toHaveBeenCalledWith(MissionError.Timeout)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('auto-retries download after timeout, then errors after all retries exhausted', () => {
    const error = vi.fn()
    const stateChanged = vi.fn()
    pm.on('error', error)
    pm.on('stateChanged', stateChanged)

    pm.loadFromVehicle()

    // First attempt: exhaust ack retries (6 timeouts)
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(1500)
    }
    // Should not error yet — download retry scheduled
    expect(error).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)

    // Advance past retry delay → second download attempt starts
    vi.advanceTimersByTime(2000)
    expect(pm.currentState).toBe(MissionProtocolState.ReadingCount)

    // Exhaust remaining 3 download retries (2nd, 3rd, 4th attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(1500)
      }
      if (attempt < 2) {
        vi.advanceTimersByTime(2000)
      }
    }

    expect(error).toHaveBeenCalledWith(MissionError.Timeout)
    expect(pm.currentState).toBe(MissionProtocolState.Error)
  })

  it('stateChanged events fire on each state transition', () => {
    const stateChanged = vi.fn()
    pm.on('stateChanged', stateChanged)

    pm.loadFromVehicle()
    expect(stateChanged).toHaveBeenCalledWith(MissionProtocolState.ReadingCount)

    pm.handleMissionCount(1)
    expect(stateChanged).toHaveBeenCalledWith(MissionProtocolState.ReadingItems)

    pm.handleMissionItemInt(makeItem(0))
    expect(stateChanged).toHaveBeenCalledWith(MissionProtocolState.Idle)
  })
})

describe('PlanManager — no link guard', () => {
  it('loadFromVehicle is a no-op without link', () => {
    const pm = new PlanManager()
    pm.loadFromVehicle()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
    pm.destroy()
  })

  it('writeToVehicle is a no-op without link', () => {
    const pm = new PlanManager()
    pm.writeToVehicle([makeItem(0)])
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
    pm.destroy()
  })

  it('removeAll is a no-op without link', () => {
    const pm = new PlanManager()
    pm.removeAll() // should not throw
    pm.destroy()
  })
})
