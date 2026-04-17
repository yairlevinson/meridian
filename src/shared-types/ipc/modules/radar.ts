import { defineIpcModule, command, event } from '../ipcModule'
import type { RadarState } from '../RadarTypes'

/**
 * Radar IPC module.
 *
 * Generates these Bridge methods:
 *   radarEnable(): Promise<void>
 *   radarDisable(): Promise<void>
 *   radarGetState(): Promise<RadarState>
 *   radarSetSimPosition(lat: number, lon: number): Promise<void>
 *   onRadarStateChanged(cb: (state: RadarState) => void): () => void
 *
 * Wire channels: radar:enable, radar:disable, radar:getState, radar:setSimPosition
 * Wire event:    radar:stateChanged
 */
export const radarModule = defineIpcModule({
  name: 'radar',
  commands: {
    enable: command<[], void>(),
    disable: command<[], void>(),
    getState: command<[], RadarState>(),
    setSimPosition: command<[lat: number, lon: number], void>()
  },
  events: {
    stateChanged: event<RadarState>()
  }
})

export type RadarModule = typeof radarModule
