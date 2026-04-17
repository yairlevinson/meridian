// @vitest-environment node
/**
 * Tests for PlanManager state guards — messages from concurrent GCS sessions
 * (e.g. QGC connected via MAVLink forwarding) must be ignored when the
 * PlanManager is not in the expected protocol state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlanManager } from '../src/main/mission/PlanManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { bindForTest } from '../src/test-utils/bindForTest'
import { MissionProtocolState, type MissionItem } from '../src/shared-types/ipc/MissionTypes'

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

describe('PlanManager — state guards against concurrent GCS traffic', () => {
  let pm: PlanManager
  let link: MockLink

  beforeEach(() => {
    pm = new PlanManager()
    link = new MockLink()
    bindForTest(pm, link)
  })

  afterEach(() => pm.destroy())

  it('ignores MISSION_COUNT when idle (other GCS downloading)', () => {
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)

    // Another GCS triggers a download — PX4 sends MISSION_COUNT
    pm.handleMissionCount(3)

    expect(loadComplete).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('ignores MISSION_COUNT(0) when idle (other GCS clearing fence/rally)', () => {
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)

    pm.handleMissionCount(0)

    expect(loadComplete).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('ignores MISSION_ITEM_INT when idle (other GCS download in progress)', () => {
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)

    pm.handleMissionItemInt(makeItem(0))
    pm.handleMissionItemInt(makeItem(1))

    expect(loadComplete).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('ignores MISSION_ACK when idle (other GCS write completed)', () => {
    const writeComplete = vi.fn()
    const error = vi.fn()
    pm.on('writeComplete', writeComplete)
    pm.on('error', error)

    pm.handleMissionAck(0)

    expect(writeComplete).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('ignores MISSION_REQUEST when idle (other GCS uploading)', () => {
    const error = vi.fn()
    pm.on('error', error)

    pm.handleMissionRequest(0)

    expect(error).not.toHaveBeenCalled()
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('processes MISSION_COUNT when in ReadingCount state (our download)', () => {
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)

    pm.loadFromVehicle()
    expect(pm.currentState).toBe(MissionProtocolState.ReadingCount)

    pm.handleMissionCount(0)

    expect(loadComplete).toHaveBeenCalledWith([])
    expect(pm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('ignores MISSION_COUNT during ReadingItems (stale response)', () => {
    pm.loadFromVehicle()
    pm.handleMissionCount(2)
    expect(pm.currentState).toBe(MissionProtocolState.ReadingItems)

    // A stale or other-GCS MISSION_COUNT arrives
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)
    pm.handleMissionCount(0)

    // Should still be reading items, not reset
    expect(pm.currentState).toBe(MissionProtocolState.ReadingItems)
    expect(loadComplete).not.toHaveBeenCalled()
  })

  it('ignores MISSION_REQUEST during ReadingCount (other GCS uploading)', () => {
    pm.loadFromVehicle()
    expect(pm.currentState).toBe(MissionProtocolState.ReadingCount)

    pm.handleMissionRequest(0)

    // Should still be in ReadingCount, not switched to WritingItems
    expect(pm.currentState).toBe(MissionProtocolState.ReadingCount)
  })

  it('own download succeeds despite concurrent idle traffic before and after', () => {
    const loadComplete = vi.fn()
    pm.on('loadComplete', loadComplete)

    // Other GCS traffic arrives while idle
    pm.handleMissionCount(5)
    pm.handleMissionItemInt(makeItem(0))
    pm.handleMissionAck(0)

    // Our download
    pm.loadFromVehicle()
    pm.handleMissionCount(2)
    pm.handleMissionItemInt(makeItem(0))
    pm.handleMissionItemInt(makeItem(1))

    expect(loadComplete).toHaveBeenCalledTimes(1)
    const items = loadComplete.mock.calls[0][0] as MissionItem[]
    expect(items).toHaveLength(2)

    // More other-GCS traffic after our download
    pm.handleMissionCount(0)
    pm.handleMissionItemInt(makeItem(0))

    // Should not have triggered another loadComplete
    expect(loadComplete).toHaveBeenCalledTimes(1)
  })

  it('own upload succeeds despite concurrent idle traffic', () => {
    const writeComplete = vi.fn()
    pm.on('writeComplete', writeComplete)

    // Other GCS traffic while idle
    pm.handleMissionRequest(0)
    pm.handleMissionAck(0)

    // Our upload
    pm.writeToVehicle([makeItem(0), makeItem(1)])
    pm.handleMissionRequest(0)
    pm.handleMissionRequest(1)
    pm.handleMissionAck(0)

    expect(writeComplete).toHaveBeenCalledTimes(1)

    // More other-GCS traffic after
    pm.handleMissionRequest(0)
    pm.handleMissionAck(0)

    expect(writeComplete).toHaveBeenCalledTimes(1)
  })
})
