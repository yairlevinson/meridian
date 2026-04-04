/** Summary of one message type, pushed in the 1 Hz snapshot */
export interface InspectorMessageSummary {
  sysid: number
  compid: number
  msgid: number
  name: string
  count: number
  rateHz: number
}

/** Field value for the currently-selected message */
export interface InspectorFieldValue {
  name: string
  value: string
  type: string
}

/** Full snapshot pushed at 1 Hz */
export interface InspectorSnapshotPayload {
  messages: InspectorMessageSummary[]
}

/** Payload pushed at 5 Hz for the selected message */
export interface InspectorFieldsPayload {
  sysid: number
  compid: number
  msgid: number
  fields: InspectorFieldValue[]
}
