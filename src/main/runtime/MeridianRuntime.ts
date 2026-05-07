import { UtilityBridge } from '../utility/UtilityBridge'
import { RadarProxy } from '../radar/RadarProxy'
import { createCoreRuntime, type CoreRuntime } from '../../core/runtime/CoreRuntime'

export interface MeridianRuntimeOptions {
  userDataPath: string
  udpPort: number
  tcpLinks?: string
}

export type MeridianRuntime = CoreRuntime<RadarProxy> & {
  utilityBridge: UtilityBridge
}

export async function createMeridianRuntime(
  options: MeridianRuntimeOptions
): Promise<MeridianRuntime> {
  const utilityBridge = new UtilityBridge()
  utilityBridge.start()

  const core = await createCoreRuntime({
    ...options,
    createRadarManager: (settingsManager) => new RadarProxy(utilityBridge, settingsManager)
  })

  return {
    ...core,
    utilityBridge,
    dispose: () => {
      core.dispose()
      void utilityBridge.stop()
    }
  }
}
