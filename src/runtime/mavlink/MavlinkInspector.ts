import type { MavLinkData, MavLinkDataConstructor } from 'node-mavlink'
import type { DecodedMessage } from '../../main/mavlink/MavlinkChannel'
import type {
  InspectorMessageSummary,
  InspectorFieldValue,
  InspectorSnapshotPayload,
  InspectorFieldsPayload
} from '@shared/ipc/MavInspectorTypes'
import { REGISTRY } from '../../main/mavlink/registry'

interface MessageStats {
  sysid: number
  compid: number
  msgid: number
  name: string
  count: number
  rateHz: number
  /** Messages counted in the current 1-second window */
  windowCount: number
  /** Last decoded data object (kept for field extraction when selected) */
  lastData: unknown
}

type EmitSnapshot = (payload: InspectorSnapshotPayload) => void
type EmitFields = (payload: InspectorFieldsPayload) => void

/**
 * Collects per-message statistics and field values for the MAVLink Inspector UI.
 * Zero overhead when disabled — handleMessage() bails on a single boolean check.
 */
export class MavlinkInspector {
  private enabled = false
  private stats = new Map<string, MessageStats>()
  private selectedKey: string | null = null
  private fieldsDirty = false

  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private fieldsTimer: ReturnType<typeof setInterval> | null = null
  private emitSnapshot: EmitSnapshot
  private emitFields: EmitFields

  constructor(emitSnapshot: EmitSnapshot, emitFields: EmitFields) {
    this.emitSnapshot = emitSnapshot
    this.emitFields = emitFields
  }

  enable(): void {
    if (this.enabled) return
    this.enabled = true

    // 1 Hz: compute rates and push message list snapshot
    this.snapshotTimer = setInterval(() => {
      this._computeRates()
      this._pushSnapshot()
    }, 1000)

    // 5 Hz: push field values for selected message
    this.fieldsTimer = setInterval(() => {
      if (this.fieldsDirty) {
        this._pushFields()
        this.fieldsDirty = false
      }
    }, 200)
  }

  disable(): void {
    if (!this.enabled) return
    this.enabled = false
    this.selectedKey = null
    this.fieldsDirty = false

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
    }
    if (this.fieldsTimer) {
      clearInterval(this.fieldsTimer)
      this.fieldsTimer = null
    }

    this.stats.clear()
  }

  select(sysid: number, compid: number, msgid: number): void {
    // Clear lastData on the previously-selected entry to free memory
    if (this.selectedKey) {
      const prev = this.stats.get(this.selectedKey)
      if (prev) prev.lastData = null
    }
    this.selectedKey = `${sysid}:${compid}:${msgid}`
    this.fieldsDirty = true
  }

  deselect(): void {
    if (this.selectedKey) {
      const prev = this.stats.get(this.selectedKey)
      if (prev) prev.lastData = null
    }
    this.selectedKey = null
    this.fieldsDirty = false
  }

  /** Called for every decoded MAVLink message. No-op when disabled. */
  handleMessage = (msg: DecodedMessage): void => {
    if (!this.enabled) return

    const key = `${msg.sysid}:${msg.compid}:${msg.msgid}`
    let entry = this.stats.get(key)

    if (!entry) {
      const regClass = REGISTRY[msg.msgid] as
        | (MavLinkDataConstructor<MavLinkData> & { MSG_NAME?: string })
        | undefined
      entry = {
        sysid: msg.sysid,
        compid: msg.compid,
        msgid: msg.msgid,
        name: regClass?.MSG_NAME ?? `MSG_${msg.msgid}`,
        count: 0,
        rateHz: 0,
        windowCount: 0,
        lastData: null
      }
      this.stats.set(key, entry)
    }

    entry.count++
    entry.windowCount++

    // Only store decoded data if this is the selected message (lazy parsing)
    if (key === this.selectedKey) {
      entry.lastData = msg.data
      this.fieldsDirty = true
    }
  }

  private _computeRates(): void {
    for (const entry of this.stats.values()) {
      // EMA matching QGC: 20% old + 80% new
      entry.rateHz = 0.2 * entry.rateHz + 0.8 * entry.windowCount
      entry.windowCount = 0
    }
  }

  private _pushSnapshot(): void {
    const messages: InspectorMessageSummary[] = []
    for (const entry of this.stats.values()) {
      messages.push({
        sysid: entry.sysid,
        compid: entry.compid,
        msgid: entry.msgid,
        name: entry.name,
        count: entry.count,
        rateHz: Math.round(entry.rateHz * 10) / 10
      })
    }
    const payload: InspectorSnapshotPayload = { messages }
    this.emitSnapshot(payload)
  }

  private _pushFields(): void {
    if (!this.selectedKey) return
    const entry = this.stats.get(this.selectedKey)
    if (!entry || !entry.lastData) return

    const fields = this._extractFields(entry.msgid, entry.lastData)
    const payload: InspectorFieldsPayload = {
      sysid: entry.sysid,
      compid: entry.compid,
      msgid: entry.msgid,
      fields
    }
    this.emitFields(payload)
  }

  private _extractFields(msgid: number, data: unknown): InspectorFieldValue[] {
    const regClass = REGISTRY[msgid] as
      | (MavLinkDataConstructor<MavLinkData> & {
          FIELDS?: Array<{ name: string; type: string }>
        })
      | undefined

    // Raw payload (unknown message)
    const raw = data as { _rawPayload?: Buffer }
    if (raw?._rawPayload) {
      return [
        {
          name: 'rawPayload',
          value: raw._rawPayload.toString('hex'),
          type: 'bytes'
        }
      ]
    }

    if (!data || typeof data !== 'object') return []

    const fieldMeta = regClass?.FIELDS
    const obj = data as Record<string, unknown>

    if (fieldMeta) {
      // Use FIELDS metadata for ordering and type info.
      // mavlink-mappings uses camelCase but MAVLink convention is snake_case.
      return fieldMeta.map((f) => ({
        name: camelToSnake(f.name),
        value: formatValue(obj[f.name]),
        type: f.type
      }))
    }

    // Fallback: iterate object keys
    return Object.keys(obj).map((key) => ({
      name: camelToSnake(key),
      value: formatValue(obj[key]),
      type: typeof obj[key]
    }))
  }
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function formatValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(6)
  }
  if (typeof v === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) return v.toString('hex')
  return String(v)
}
