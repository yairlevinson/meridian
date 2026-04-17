// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ParameterManager } from '../src/main/parameters/ParameterManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { bindForTest } from '../src/test-utils/bindForTest'
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
    bindForTest(pm, link)
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

describe('ParameterManager — integer param type decoding', () => {
  let pm: ParameterManager
  let link: MockLink

  // Helper: encode an integer as float32 bits (simulates what MAVLink wire format does)
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  const i32 = new Int32Array(f32.buffer)
  const u16 = new Uint16Array(f32.buffer)
  const i16 = new Int16Array(f32.buffer)
  const u8 = new Uint8Array(f32.buffer)
  const i8 = new Int8Array(f32.buffer)

  function encodeAsFloat(intValue: number, type: ParamValueType): number {
    // Zero the buffer first
    u32[0] = 0
    switch (type) {
      case ParamValueType.UINT8:
        u8[0] = intValue
        break
      case ParamValueType.INT8:
        i8[0] = intValue
        break
      case ParamValueType.UINT16:
        u16[0] = intValue
        break
      case ParamValueType.INT16:
        i16[0] = intValue
        break
      case ParamValueType.UINT32:
        u32[0] = intValue
        break
      case ParamValueType.INT32:
        i32[0] = intValue
        break
      default:
        return intValue
    }
    return f32[0]
  }

  beforeEach(() => {
    pm = new ParameterManager()
    link = new MockLink()
    bindForTest(pm, link)
    pm.requestAllParameters()
  })

  afterEach(() => {
    pm.destroy()
  })

  it('decodes UINT32 param (e.g. SYS_AUTOSTART=4001)', () => {
    const wireFloat = encodeAsFloat(4001, ParamValueType.UINT32)
    pm.handleParamValue(makeParamValue('SYS_AUTOSTART', wireFloat, 0, 1, ParamValueType.UINT32))
    expect(pm.getParameter('SYS_AUTOSTART')?.value).toBe(4001)
  })

  it('decodes INT32 param', () => {
    const wireFloat = encodeAsFloat(-42, ParamValueType.INT32)
    pm.handleParamValue(makeParamValue('MY_INT_PARAM', wireFloat, 0, 1, ParamValueType.INT32))
    expect(pm.getParameter('MY_INT_PARAM')?.value).toBe(-42)
  })

  it('decodes UINT16 param', () => {
    const wireFloat = encodeAsFloat(1000, ParamValueType.UINT16)
    pm.handleParamValue(makeParamValue('SERVO1_MIN', wireFloat, 0, 1, ParamValueType.UINT16))
    expect(pm.getParameter('SERVO1_MIN')?.value).toBe(1000)
  })

  it('decodes INT16 param', () => {
    const wireFloat = encodeAsFloat(-100, ParamValueType.INT16)
    pm.handleParamValue(makeParamValue('NEG_PARAM', wireFloat, 0, 1, ParamValueType.INT16))
    expect(pm.getParameter('NEG_PARAM')?.value).toBe(-100)
  })

  it('decodes UINT8 param', () => {
    const wireFloat = encodeAsFloat(3, ParamValueType.UINT8)
    pm.handleParamValue(makeParamValue('FRAME_CLASS', wireFloat, 0, 1, ParamValueType.UINT8))
    expect(pm.getParameter('FRAME_CLASS')?.value).toBe(3)
  })

  it('decodes INT8 param', () => {
    const wireFloat = encodeAsFloat(-1, ParamValueType.INT8)
    pm.handleParamValue(makeParamValue('TINY_PARAM', wireFloat, 0, 1, ParamValueType.INT8))
    expect(pm.getParameter('TINY_PARAM')?.value).toBe(-1)
  })

  it('passes REAL32 param through unchanged', () => {
    pm.handleParamValue(makeParamValue('MPC_XY_VEL', 12.5, 0, 1, ParamValueType.REAL32))
    expect(pm.getParameter('MPC_XY_VEL')?.value).toBeCloseTo(12.5)
  })

  it('round-trips: decoded value matches original integer', () => {
    // SYS_AUTOSTART=4001 is the value that was showing as 5.6e-42
    const original = 4001
    const wireFloat = encodeAsFloat(original, ParamValueType.UINT32)
    // wireFloat is a tiny denormalized float — NOT 4001
    expect(wireFloat).not.toBe(original)
    // But after decoding, we get the integer back
    pm.handleParamValue(makeParamValue('SYS_AUTOSTART', wireFloat, 0, 1, ParamValueType.UINT32))
    expect(pm.getParameter('SYS_AUTOSTART')?.value).toBe(original)
  })
})
