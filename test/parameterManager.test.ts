// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ParameterManager } from '../src/main/parameters/ParameterManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { ParamValueType } from '../src/shared-types/ipc/ParameterTypes'

function makeParamValue(
  name: string,
  value: number,
  index: number,
  count: number,
  type = ParamValueType.REAL32
) {
  return {
    paramId: name,
    paramValue: value,
    paramType: type,
    paramCount: count,
    paramIndex: index
  }
}

describe('ParameterManager', () => {
  let pm: ParameterManager
  let link: MockLink

  beforeEach(() => {
    pm = new ParameterManager()
    link = new MockLink()
    pm.setLink(link)
  })

  afterEach(() => {
    pm.destroy()
  })

  it('requestAllParameters sends PARAM_REQUEST_LIST', () => {
    pm.requestAllParameters()
    expect(link.sentBuffers).toHaveLength(1)
  })

  it('accumulates PARAM_VALUE messages and fires progress', () => {
    const progressEvents: unknown[] = []
    pm.on('progress', (s) => progressEvents.push(s))

    pm.requestAllParameters()

    // Simulate receiving 5 params
    for (let i = 0; i < 5; i++) {
      pm.handleParamValue(makeParamValue(`PARAM_${i}`, i * 1.5, i, 5))
    }

    expect(pm.parametersReady).toBe(true)
    expect(pm.getAllParameters()).toHaveLength(5)
    expect(pm.getParameter('PARAM_0')?.value).toBe(0)
    expect(pm.getParameter('PARAM_4')?.value).toBe(6.0)
    expect(progressEvents.length).toBe(5)
  })

  it('loadProgress tracks correctly', () => {
    pm.requestAllParameters()
    pm.handleParamValue(makeParamValue('P1', 1.0, 0, 10))
    pm.handleParamValue(makeParamValue('P2', 2.0, 1, 10))
    pm.handleParamValue(makeParamValue('P3', 3.0, 2, 10))

    const state = pm.loadState
    expect(state.loadProgress).toBeCloseTo(0.3)
    expect(state.receivedCount).toBe(3)
    expect(state.totalCount).toBe(10)
    expect(state.parametersReady).toBe(false)
  })

  it('fires parametersReady when all params received', () => {
    const ready = vi.fn()
    pm.on('parametersReady', ready)

    pm.requestAllParameters()
    for (let i = 0; i < 3; i++) {
      pm.handleParamValue(makeParamValue(`P${i}`, i, i, 3))
    }

    expect(ready).toHaveBeenCalled()
    expect(pm.parametersReady).toBe(true)
  })

  it('detects missing parameters after retries', async () => {
    const missingEvent = new Promise<number[]>((resolve) => {
      pm.on('missingParameters', resolve)
    })

    // Hack retry settings for fast testing
    ;(pm as any).retryTimeoutMs = 100
    ;(pm as any).maxRetryCount = 1

    pm.requestAllParameters()
    // Only send 2 out of 5 params
    pm.handleParamValue(makeParamValue('P0', 0, 0, 5))
    pm.handleParamValue(makeParamValue('P2', 2, 2, 5))

    const missing = await missingEvent
    expect(missing).toContain(1)
    expect(missing).toContain(3)
    expect(missing).toContain(4)
  })

  it('getMissingIndices returns correct indices', () => {
    pm.requestAllParameters()
    pm.handleParamValue(makeParamValue('P0', 0, 0, 5))
    pm.handleParamValue(makeParamValue('P2', 2, 2, 5))
    pm.handleParamValue(makeParamValue('P4', 4, 4, 5))

    const missing = pm.getMissingIndices()
    expect(missing).toEqual([1, 3])
  })

  it('setParameter sends PARAM_SET and tracks pending write', () => {
    pm.requestAllParameters()
    // Pre-load a param
    pm.handleParamValue(makeParamValue('MPC_XY_VEL_MAX', 12.0, 0, 1))

    pm.setParameter('MPC_XY_VEL_MAX', 15.0)
    expect(link.sentBuffers).toHaveLength(2) // requestAll + set
    expect(pm.loadState.pendingWrites).toBe(1)
  })

  it('pending write resolves when PARAM_VALUE echoes back', () => {
    const complete = vi.fn()
    pm.on('parameterWriteComplete', complete)

    pm.requestAllParameters()
    pm.handleParamValue(makeParamValue('MPC_XY_VEL_MAX', 12.0, 0, 1))
    pm.setParameter('MPC_XY_VEL_MAX', 15.0)

    // Vehicle echoes back the updated value
    pm.handleParamValue(makeParamValue('MPC_XY_VEL_MAX', 15.0, 0, 1))

    expect(complete).toHaveBeenCalledWith('MPC_XY_VEL_MAX')
    expect(pm.loadState.pendingWrites).toBe(0)
    expect(pm.getParameter('MPC_XY_VEL_MAX')?.value).toBe(15.0)
  })

  it('handles duplicate PARAM_VALUE for same index', () => {
    pm.requestAllParameters()
    pm.handleParamValue(makeParamValue('P0', 1.0, 0, 3))
    pm.handleParamValue(makeParamValue('P0', 1.5, 0, 3)) // duplicate
    pm.handleParamValue(makeParamValue('P1', 2.0, 1, 3))
    pm.handleParamValue(makeParamValue('P2', 3.0, 2, 3))

    expect(pm.parametersReady).toBe(true)
    expect(pm.getParameter('P0')?.value).toBe(1.5) // latest value wins
  })
})
