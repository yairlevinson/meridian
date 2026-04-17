import { command, event, defineIpcModule } from '../ipcModule'
import type { InspectorSnapshotPayload, InspectorFieldsPayload } from '../MavInspectorTypes'

export const mavInspectorModule = defineIpcModule({
  name: 'mavInspector',
  commands: {
    enable: command<[], void>(),
    disable: command<[], void>(),
    select: command<[sysid: number, compid: number, msgid: number], void>(),
    deselect: command<[], void>()
  },
  events: {
    snapshot: event<InspectorSnapshotPayload>(),
    fields: event<InspectorFieldsPayload>()
  }
})

export type MavInspectorModule = typeof mavInspectorModule
