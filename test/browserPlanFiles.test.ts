// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parsePlanFileText,
  savePlanToBrowserDownload,
  serializePlanFile
} from '../src/renderer/src/transport/browserPlanFiles'
import { MissionType } from '../src/shared-types/ipc/MissionTypes'
import type { PlanFile } from '../src/shared-types/ipc/MissionTypes'

const planFile: PlanFile = {
  fileHeader: { version: 1, createdBy: 'meridian' },
  mission: {
    items: [
      {
        seq: 0,
        frame: 3,
        command: 16,
        current: false,
        autocontinue: true,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: 32.1,
        y: 34.8,
        z: 50,
        missionType: MissionType.Mission
      }
    ]
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('browser plan files', () => {
  it('serializes and parses plan files without Node file APIs', () => {
    const text = serializePlanFile(planFile)

    expect(parsePlanFileText(text, 'mission.plan')).toEqual(planFile)
    expect(() => parsePlanFileText('not json', 'bad.plan')).toThrow('Invalid JSON in bad.plan')
    expect(() => parsePlanFileText('{"mission":{"items":[]}}', 'bad.plan')).toThrow(
      'Invalid plan file format: bad.plan'
    )
  })

  it('downloads plans locally in browser mode', async () => {
    const createObjectURL = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:plan')
    const revokeObjectURL = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await expect(savePlanToBrowserDownload(planFile, 'test.plan')).resolves.toEqual({
      filePath: 'test.plan'
    })

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:plan')
    expect(document.querySelector('a[download="test.plan"]')).toBeNull()
  })
})
