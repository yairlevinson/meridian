import type { RpcCommandImpls } from '@shared/rpc'
import type { MavInspectorModule } from '@shared/ipc/modules/mavInspector'
import type { MavlinkInspector } from '../../main/mavlink/MavlinkInspector'

export function createMavInspectorCommandHandlers(
  inspector: MavlinkInspector
): RpcCommandImpls<MavInspectorModule> {
  return {
    enable: async () => inspector.enable(),
    disable: async () => inspector.disable(),
    select: async (sysid, compid, msgid) => inspector.select(sysid, compid, msgid),
    deselect: async () => inspector.deselect()
  }
}
