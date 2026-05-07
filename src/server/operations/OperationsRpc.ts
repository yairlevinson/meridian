import type { EventEmitter } from 'events'
import { forwardingModule } from '@shared/ipc/modules/forwarding'
import { radarModule } from '@shared/ipc/modules/radar'
import type { ForwardingState } from '@shared/ipc/ForwardingTypes'
import type { RadarState } from '@shared/ipc/RadarTypes'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

const EMPTY_FORWARDING_STATE: ForwardingState = { enabled: false, targets: [] }
const EMPTY_RADAR_STATE: RadarState = {
  enabled: false,
  units: [],
  tracks: [],
  simulationActive: false
}

type ForwarderLike = Pick<EventEmitter, 'on' | 'off'> & {
  getState: () => ForwardingState
  addTarget: (host: string, port: number) => string
  removeTarget: (id: string) => void
  setEnabled: (enabled: boolean) => void
  setTargetEnabled: (id: string, enabled: boolean) => void
}

export type RadarManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  enable: () => void
  disable: () => void
  getState: () => RadarState
  setSimulationPosition: (lat: number, lon: number) => void
}

export function registerForwardingRpc(
  realtime: RpcRealtimeServer,
  forwarder: ForwarderLike | null
): () => void {
  realtime.registerModule(forwardingModule, {
    commands: {
      getState: async () => forwarder?.getState() ?? EMPTY_FORWARDING_STATE,
      addTarget: async (host, port) => {
        if (!forwarder) throw new Error('MAVLink forwarder not available')
        return forwarder.addTarget(host, port)
      },
      removeTarget: async (id) => {
        if (!forwarder) throw new Error('MAVLink forwarder not available')
        forwarder.removeTarget(id)
      },
      setEnabled: async (enabled) => {
        if (!forwarder) throw new Error('MAVLink forwarder not available')
        forwarder.setEnabled(enabled)
      },
      setTargetEnabled: async (id, enabled) => {
        if (!forwarder) throw new Error('MAVLink forwarder not available')
        forwarder.setTargetEnabled(id, enabled)
      }
    }
  })

  if (!forwarder) return () => {}

  const onStateChanged = (state: ForwardingState): void => {
    realtime.emitEvent('forwarding', 'stateChanged', state)
  }
  forwarder.on('stateChanged', onStateChanged)
  return () => {
    forwarder.off('stateChanged', onStateChanged)
  }
}

export function registerRadarRpc(
  realtime: RpcRealtimeServer,
  radarManager: RadarManagerLike | null
): () => void {
  realtime.registerModule(radarModule, {
    commands: {
      enable: async () => {
        if (!radarManager) throw new Error('Radar manager not available')
        radarManager.enable()
      },
      disable: async () => {
        if (!radarManager) throw new Error('Radar manager not available')
        radarManager.disable()
      },
      getState: async () => radarManager?.getState() ?? EMPTY_RADAR_STATE,
      setSimPosition: async (lat, lon) => {
        if (!radarManager) throw new Error('Radar manager not available')
        radarManager.setSimulationPosition(lat, lon)
      }
    }
  })

  if (!radarManager) return () => {}

  const onStateChanged = (state: RadarState): void => {
    realtime.emitEvent('radar', 'stateChanged', state)
  }
  radarManager.on('stateChanged', onStateChanged)
  return () => {
    radarManager.off('stateChanged', onStateChanged)
  }
}
