import { EventEmitter } from 'events'
import { common } from 'mavlink-mappings'
import type { LinkInterface } from '../links/LinkInterface'
import { createGcsProtocol } from '../mavlink/constants'
import { ParamValueType, type Parameter, type ParameterLoadState } from '@shared/ipc/ParameterTypes'

// Shared buffer for float↔int reinterpretation
const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)
const _i32 = new Int32Array(_f32.buffer)
const _u16 = new Uint16Array(_f32.buffer)
const _i16 = new Int16Array(_f32.buffer)
const _u8 = new Uint8Array(_f32.buffer)
const _i8 = new Int8Array(_f32.buffer)

/**
 * MAVLink encodes all parameter values as float32 on the wire.
 * Integer-typed params store their bits in the float — we must reinterpret.
 */
function decodeParamValue(rawFloat: number, paramType: number): number {
  _f32[0] = rawFloat
  switch (paramType) {
    case ParamValueType.UINT8:
      return _u8[0]
    case ParamValueType.INT8:
      return _i8[0]
    case ParamValueType.UINT16:
      return _u16[0]
    case ParamValueType.INT16:
      return _i16[0]
    case ParamValueType.UINT32:
      return _u32[0]
    case ParamValueType.INT32:
      return _i32[0]
    case ParamValueType.REAL32:
    default:
      return rawFloat
  }
}

/** Encode an integer parameter value as float32 bits for PARAM_SET */
function encodeParamValue(value: number, paramType: number): number {
  switch (paramType) {
    case ParamValueType.UINT8:
      _u8[0] = value
      return _f32[0]
    case ParamValueType.INT8:
      _i8[0] = value
      return _f32[0]
    case ParamValueType.UINT16:
      _u16[0] = value
      return _f32[0]
    case ParamValueType.INT16:
      _i16[0] = value
      return _f32[0]
    case ParamValueType.UINT32:
      _u32[0] = value
      return _f32[0]
    case ParamValueType.INT32:
      _i32[0] = value
      return _f32[0]
    case ParamValueType.REAL32:
    default:
      return value
  }
}

/**
 * Parameter protocol state machine.
 * Handles PARAM_REQUEST_LIST, PARAM_VALUE accumulation, missing-param retry,
 * and PARAM_SET with ACK tracking.
 */
export class ParameterManager extends EventEmitter {
  private params = new Map<string, Parameter>()
  private totalExpected = -1
  private receivedIndices = new Set<number>()
  private retryCount = 0
  private maxRetryCount = 3
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimeoutMs = 3000
  private pendingWrites = new Map<string, { value: number; timer: ReturnType<typeof setTimeout> }>()
  private protocol = createGcsProtocol()
  private seq = 0
  private link: LinkInterface | null = null
  private targetSystem = 1
  private componentId = 1

  get parametersReady(): boolean {
    return this.totalExpected > 0 && this.receivedIndices.size >= this.totalExpected
  }

  get missingParameters(): boolean {
    return this.retryCount >= this.maxRetryCount && !this.parametersReady
  }

  get loadState(): ParameterLoadState {
    return {
      totalCount: this.totalExpected,
      receivedCount: this.receivedIndices.size,
      loadProgress: this.totalExpected > 0 ? this.receivedIndices.size / this.totalExpected : 0,
      parametersReady: this.parametersReady,
      missingParameters: this.missingParameters,
      missingIndices: this.getMissingIndices(),
      retryCount: this.retryCount,
      pendingWrites: this.pendingWrites.size
    }
  }

  setLink(link: LinkInterface): void {
    this.link = link
  }

  setTarget(sysid: number, compid: number): void {
    this.targetSystem = sysid
    this.componentId = compid
  }

  /** Start a full parameter request */
  requestAllParameters(): void {
    if (!this.link) return
    this.params.clear()
    this.receivedIndices.clear()
    this.totalExpected = -1
    this.retryCount = 0

    const req = new common.ParamRequestList()
    req.targetSystem = this.targetSystem
    req.targetComponent = this.componentId
    const buf = this.protocol.serialize(req, this.seq++ & 0xff)
    this.link.writeBytes(buf)

    this._startRetryTimer()
    this.emit('loadStarted')
  }

  /** Handle PARAM_VALUE message from vehicle */
  handleParamValue(pv: {
    paramId: string
    paramValue: number
    paramType: number
    paramCount: number
    paramIndex: number
  }): void {
    if (this.totalExpected < 0) {
      this.totalExpected = pv.paramCount
    }

    const name = pv.paramId.replace(/\0/g, '')
    const param: Parameter = {
      name,
      value: decodeParamValue(pv.paramValue, pv.paramType),
      type: pv.paramType as ParamValueType,
      index: pv.paramIndex,
      componentId: this.componentId
    }

    this.params.set(name, param)
    this.receivedIndices.add(pv.paramIndex)

    // Check for pending write ACK
    const pending = this.pendingWrites.get(name)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingWrites.delete(name)
      this.emit('parameterWriteComplete', name)
    }

    this.emit('parameterReceived', param)
    this.emit('progress', this.loadState)

    if (this.parametersReady) {
      this._clearRetryTimer()
      this.emit('parametersReady')
    }
  }

  /** Set a parameter value on the vehicle */
  setParameter(name: string, value: number, type?: ParamValueType): void {
    if (!this.link) return

    const existing = this.params.get(name)
    const paramType = type ?? existing?.type ?? ParamValueType.REAL32

    const req = new common.ParamSet()
    req.targetSystem = this.targetSystem
    req.targetComponent = this.componentId
    req.paramId = name
    req.paramValue = encodeParamValue(value, paramType)
    req.paramType = paramType as number as typeof req.paramType

    const buf = this.protocol.serialize(req, this.seq++ & 0xff)
    this.link.writeBytes(buf)

    // Track pending write
    const timer = setTimeout(() => {
      this.pendingWrites.delete(name)
      this.emit('parameterWriteTimeout', name)
    }, 3000)
    this.pendingWrites.set(name, { value, timer })
    this.emit('progress', this.loadState)
  }

  /** Get a parameter by name */
  getParameter(name: string): Parameter | undefined {
    return this.params.get(name)
  }

  /** Get all parameters */
  getAllParameters(): Parameter[] {
    return Array.from(this.params.values())
  }

  /** Get indices of missing parameters */
  getMissingIndices(): number[] {
    if (this.totalExpected <= 0) return []
    const missing: number[] = []
    for (let i = 0; i < this.totalExpected; i++) {
      if (!this.receivedIndices.has(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  destroy(): void {
    this._clearRetryTimer()
    for (const [, pending] of this.pendingWrites) {
      clearTimeout(pending.timer)
    }
    this.pendingWrites.clear()
  }

  private _startRetryTimer(): void {
    this._clearRetryTimer()
    this.retryTimer = setTimeout(() => this._retryMissing(), this.retryTimeoutMs)
  }

  private _clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private _retryMissing(): void {
    if (this.parametersReady) return
    if (!this.link) return

    this.retryCount++
    if (this.retryCount > this.maxRetryCount) {
      this.emit('missingParameters', this.getMissingIndices())
      return
    }

    const missing = this.getMissingIndices()
    for (const idx of missing) {
      const req = new common.ParamRequestRead()
      req.targetSystem = this.targetSystem
      req.targetComponent = this.componentId
      req.paramIndex = idx
      req.paramId = '' // empty = use index
      const buf = this.protocol.serialize(req, this.seq++ & 0xff)
      this.link.writeBytes(buf)
    }

    this._startRetryTimer()
    this.emit('retrying', { retryCount: this.retryCount, missingCount: missing.length })
  }
}
