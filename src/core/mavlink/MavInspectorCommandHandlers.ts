import type { RpcCommandImpls } from '@shared/rpc'
import type { MavInspectorModule } from '@shared/ipc/modules/mavInspector'

export interface MavlinkInspectorLike {
  enable: () => void
  disable: () => void
  select: (sysid: number, compid: number, msgid: number) => void
  deselect: () => void
}

export function createMavInspectorCommandHandlers(
  inspector: MavlinkInspectorLike
): RpcCommandImpls<MavInspectorModule> {
  return {
    enable: async () => inspector.enable(),
    disable: async () => inspector.disable(),
    select: async (sysid, compid, msgid) => inspector.select(sysid, compid, msgid),
    deselect: async () => inspector.deselect()
  }
}
