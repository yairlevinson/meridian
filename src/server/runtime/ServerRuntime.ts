import { join } from 'path'
import { homedir } from 'os'
import { createCoreRuntime, type CoreRuntime } from '../../runtime/CoreRuntime'
import { ServerRadarManager } from '../operations/ServerRadarManager'

export interface ServerRuntimeOptions {
  userDataPath?: string
  udpPort?: number
  tcpLinks?: string
}

export type ServerRuntime = CoreRuntime<ServerRadarManager>

export async function createServerRuntime(
  options: ServerRuntimeOptions = {}
): Promise<ServerRuntime> {
  const udpPort = options.udpPort ?? 14550
  const userDataPath = options.userDataPath ?? join(homedir(), '.meridian')

  return createCoreRuntime({
    userDataPath,
    udpPort,
    tcpLinks: options.tcpLinks,
    createRadarManager: (settingsManager) => new ServerRadarManager(settingsManager)
  })
}
