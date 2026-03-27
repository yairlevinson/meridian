// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GeoFenceManager } from '../src/main/mission/GeoFenceManager'
import { RallyPointManager } from '../src/main/mission/RallyPointManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import {
  MissionType,
  MissionProtocolState,
  MissionError,
  type MissionItem
} from '../src/shared-types/ipc/MissionTypes'

function makeFenceItem(seq: number, lat = 42.389, lon = -71.147): MissionItem {
  return {
    seq,
    frame: 3,
    command: 5001, // MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
    current: false,
    autocontinue: false,
    param1: 4, // vertex count
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: 0,
    missionType: MissionType.Fence
  }
}

function makeRallyItem(seq: number, lat = 42.389, lon = -71.147, alt = 100): MissionItem {
  return {
    seq,
    frame: 3,
    command: 5100, // MAV_CMD_NAV_RALLY_POINT
    current: false,
    autocontinue: false,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: alt,
    missionType: MissionType.Rally
  }
}

describe('GeoFenceManager', () => {
  let gfm: GeoFenceManager
  let link: MockLink

  beforeEach(() => {
    gfm = new GeoFenceManager()
    link = new MockLink()
    gfm.setLink(link)
  })

  afterEach(() => gfm.destroy())

  it('uses MissionType.Fence (1)', () => {
    expect((gfm as any).missionType).toBe(MissionType.Fence)
  })

  it('downloads fence items from vehicle', () => {
    const complete = vi.fn()
    gfm.on('loadComplete', complete)

    gfm.loadFromVehicle()
    expect(gfm.currentState).toBe(MissionProtocolState.ReadingCount)

    gfm.handleMissionCount(3)
    expect(gfm.currentState).toBe(MissionProtocolState.ReadingItems)

    gfm.handleMissionItemInt(makeFenceItem(0, 42.389, -71.147))
    gfm.handleMissionItemInt(makeFenceItem(1, 42.39, -71.146))
    gfm.handleMissionItemInt(makeFenceItem(2, 42.391, -71.145))

    expect(complete).toHaveBeenCalled()
    expect(gfm.currentItems).toHaveLength(3)
    expect(gfm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('uploads fence items to vehicle', () => {
    const complete = vi.fn()
    gfm.on('writeComplete', complete)

    const items = [makeFenceItem(0, 42.389, -71.147), makeFenceItem(1, 42.39, -71.146)]
    gfm.writeToVehicle(items)
    expect(gfm.currentState).toBe(MissionProtocolState.WritingCount)

    gfm.handleMissionRequest(0)
    gfm.handleMissionRequest(1)
    gfm.handleMissionAck(0) // ACCEPTED

    expect(complete).toHaveBeenCalled()
    expect(gfm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('handles empty fence (count=0)', () => {
    const complete = vi.fn()
    gfm.on('loadComplete', complete)

    gfm.loadFromVehicle()
    gfm.handleMissionCount(0)

    expect(complete).toHaveBeenCalledWith([])
    expect(gfm.currentState).toBe(MissionProtocolState.Idle)
  })

  it('handles error ACK during fence upload', () => {
    const error = vi.fn()
    gfm.on('error', error)

    gfm.writeToVehicle([makeFenceItem(0)])
    gfm.handleMissionAck(MissionError.Unsupported)

    expect(error).toHaveBeenCalledWith(MissionError.Unsupported)
    expect(gfm.currentState).toBe(MissionProtocolState.Error)
  })

  it('sends MISSION_CLEAR_ALL for fence', () => {
    gfm.removeAll()
    expect(link.sentBuffers).toHaveLength(1)
  })
})

describe('RallyPointManager', () => {
  let rpm: RallyPointManager
  let link: MockLink

  beforeEach(() => {
    rpm = new RallyPointManager()
    link = new MockLink()
    rpm.setLink(link)
  })

  afterEach(() => rpm.destroy())

  it('uses MissionType.Rally (2)', () => {
    expect((rpm as any).missionType).toBe(MissionType.Rally)
  })

  it('downloads rally points from vehicle', () => {
    const complete = vi.fn()
    rpm.on('loadComplete', complete)

    rpm.loadFromVehicle()
    rpm.handleMissionCount(2)

    rpm.handleMissionItemInt(makeRallyItem(0, 42.389, -71.147, 100))
    rpm.handleMissionItemInt(makeRallyItem(1, 42.39, -71.146, 150))

    expect(complete).toHaveBeenCalled()
    const items = rpm.currentItems
    expect(items).toHaveLength(2)
    expect(items[0].z).toBe(100)
    expect(items[1].z).toBe(150)
  })

  it('uploads rally points to vehicle', () => {
    const complete = vi.fn()
    rpm.on('writeComplete', complete)

    const items = [makeRallyItem(0), makeRallyItem(1)]
    rpm.writeToVehicle(items)

    rpm.handleMissionRequest(0)
    rpm.handleMissionRequest(1)
    rpm.handleMissionAck(0)

    expect(complete).toHaveBeenCalled()
  })

  it('handles empty rally points (count=0)', () => {
    const complete = vi.fn()
    rpm.on('loadComplete', complete)

    rpm.loadFromVehicle()
    rpm.handleMissionCount(0)

    expect(complete).toHaveBeenCalledWith([])
  })

  it('handles error ACK during rally upload', () => {
    const error = vi.fn()
    rpm.on('error', error)

    rpm.writeToVehicle([makeRallyItem(0)])
    rpm.handleMissionAck(MissionError.Denied)

    expect(error).toHaveBeenCalledWith(MissionError.Denied)
    expect(rpm.currentState).toBe(MissionProtocolState.Error)
  })

  it('sends MISSION_CLEAR_ALL for rally', () => {
    rpm.removeAll()
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('tracks progress during download', () => {
    const progress = vi.fn()
    rpm.on('progress', progress)

    rpm.loadFromVehicle()
    rpm.handleMissionCount(3)

    rpm.handleMissionItemInt(makeRallyItem(0))
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 3 })

    rpm.handleMissionItemInt(makeRallyItem(1))
    expect(progress).toHaveBeenCalledWith({ current: 2, total: 3 })

    rpm.handleMissionItemInt(makeRallyItem(2))
    expect(progress).toHaveBeenCalledWith({ current: 3, total: 3 })
  })
})
