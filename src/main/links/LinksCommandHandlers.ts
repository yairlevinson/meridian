import { SerialPort } from 'serialport'
import type { RpcCommandImpls } from '@shared/rpc'
import type { LinksModule } from '@shared/ipc/modules/links'
import type { LinkManager } from './LinkManager'

export function createLinksCommandHandlers(
  linkManager: LinkManager | null
): RpcCommandImpls<LinksModule> {
  const requireLinkManager = (): LinkManager => {
    if (!linkManager) throw new Error('LinkManager not available')
    return linkManager
  }

  return {
    create: async (config) => {
      const link = await requireLinkManager().createLink(config)
      return { id: link.id, status: link.status }
    },
    disconnect: async (id) => {
      requireLinkManager().disconnectLink(id)
    },
    getAll: async () => linkManager?.getAllStates() ?? [],
    listSerialPorts: async () => {
      const ports = await SerialPort.list()
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId
      }))
    }
  }
}
