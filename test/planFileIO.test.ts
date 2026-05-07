// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { promises as fs } from 'fs'
import { validatePlanFile, savePlanFile, loadPlanFile } from '../src/core/mission/PlanFileIO'
import type { PlanFile } from '../src/shared-types/ipc/MissionTypes'

const makePlan = (): PlanFile => ({
  fileHeader: { version: 1, createdBy: 'test' },
  mission: {
    items: [
      {
        seq: 0,
        frame: 3,
        command: 16,
        current: true,
        autocontinue: true,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: 473977500,
        y: 85455620,
        z: 50,
        missionType: 0
      }
    ]
  }
})

describe('validatePlanFile', () => {
  it('accepts a valid plan', () => {
    expect(validatePlanFile(makePlan())).toBe(true)
  })

  it('rejects null', () => {
    expect(validatePlanFile(null)).toBe(false)
  })

  it('rejects missing fileHeader', () => {
    expect(validatePlanFile({ mission: { items: [] } })).toBe(false)
  })

  it('rejects missing mission', () => {
    expect(validatePlanFile({ fileHeader: { version: 1 } })).toBe(false)
  })

  it('rejects non-numeric version', () => {
    expect(validatePlanFile({ fileHeader: { version: '1' }, mission: { items: [] } })).toBe(false)
  })

  it('rejects mission item missing seq', () => {
    expect(
      validatePlanFile({
        fileHeader: { version: 1, createdBy: 'test' },
        mission: { items: [{ frame: 3, command: 16, x: 0, y: 0, z: 0 }] }
      })
    ).toBe(false)
  })

  it('rejects mission items that is not an array', () => {
    expect(
      validatePlanFile({
        fileHeader: { version: 1, createdBy: 'test' },
        mission: { items: 'not-array' }
      })
    ).toBe(false)
  })
})

describe('savePlanFile / loadPlanFile round-trip', () => {
  it('saves and loads a plan file correctly', async () => {
    const plan = makePlan()
    const filePath = join(tmpdir(), `meridian-test-${Date.now()}.plan`)

    await savePlanFile(filePath, plan)
    const loaded = await loadPlanFile(filePath)

    expect(loaded).toEqual(plan)

    // Cleanup
    await fs.unlink(filePath)
  })
})

describe('loadPlanFile error handling', () => {
  it('throws on non-existent file', async () => {
    await expect(loadPlanFile('/tmp/nonexistent-plan-file.plan')).rejects.toThrow()
  })

  it('throws on invalid JSON', async () => {
    const filePath = join(tmpdir(), `meridian-bad-json-${Date.now()}.plan`)
    await fs.writeFile(filePath, 'not valid json{{{', 'utf-8')

    await expect(loadPlanFile(filePath)).rejects.toThrow('Invalid JSON')

    await fs.unlink(filePath)
  })

  it('throws on valid JSON but invalid plan format', async () => {
    const filePath = join(tmpdir(), `meridian-bad-plan-${Date.now()}.plan`)
    await fs.writeFile(filePath, JSON.stringify({ hello: 'world' }), 'utf-8')

    await expect(loadPlanFile(filePath)).rejects.toThrow('Invalid plan file format')

    await fs.unlink(filePath)
  })
})
