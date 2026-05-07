import type { EventEmitter } from 'events'
import type { RpcCommandImpls } from '@shared/rpc'
import type { ForwardingModule } from '@shared/ipc/modules/forwarding'
import type { RadarModule } from '@shared/ipc/modules/radar'
import type { ForwardingState } from '@shared/ipc/ForwardingTypes'
import type { RadarState } from '@shared/ipc/RadarTypes'

const EMPTY_FORWARDING_STATE: ForwardingState = { enabled: false, targets: [] }
const EMPTY_RADAR_STATE: RadarState = {
  enabled: false,
  units: [],
  tracks: [],
  simulationActive: false
}

export type ForwarderLike = Pick<EventEmitter, 'on' | 'off' | 'removeListener'> & {
  getState: () => ForwardingState
  addTarget: (host: string, port: number) => string
  removeTarget: (id: string) => void
  setEnabled: (enabled: boolean) => void
  setTargetEnabled: (id: string, enabled: boolean) => void
}

export type RadarManagerLike = Pick<EventEmitter, 'on' | 'off' | 'removeListener'> & {
  enable: () => void
  disable: () => void
  getState: () => RadarState
  setSimulationPosition: (lat: number, lon: number) => void
}

export function createForwardingCommandHandlers(
  forwarder: ForwarderLike | null
): RpcCommandImpls<ForwardingModule> {
  const requireForwarder = (): ForwarderLike => {
    if (!forwarder) throw new Error('MAVLink forwarder not available')
    return forwarder
  }

  return {
    getState: async () => forwarder?.getState() ?? EMPTY_FORWARDING_STATE,
    addTarget: async (host, port) => requireForwarder().addTarget(host, port),
    removeTarget: async (id) => {
      requireForwarder().removeTarget(id)
    },
    setEnabled: async (enabled) => {
      requireForwarder().setEnabled(enabled)
    },
    setTargetEnabled: async (id, enabled) => {
      requireForwarder().setTargetEnabled(id, enabled)
    }
  }
}

export function createRadarCommandHandlers(
  radarManager: RadarManagerLike | null
): RpcCommandImpls<RadarModule> {
  const requireRadarManager = (): RadarManagerLike => {
    if (!radarManager) throw new Error('Radar manager not available')
    return radarManager
  }

  return {
    enable: async () => {
      requireRadarManager().enable()
    },
    disable: async () => {
      requireRadarManager().disable()
    },
    getState: async () => radarManager?.getState() ?? EMPTY_RADAR_STATE,
    setSimPosition: async (lat, lon) => {
      requireRadarManager().setSimulationPosition(lat, lon)
    }
  }
}
