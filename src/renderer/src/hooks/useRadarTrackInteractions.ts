import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useRadarStore } from '../store/radarStore'
import { useVehicleStore } from '../store/vehicleStore'
import { rlog } from '../lib/rlog'

const TRACKS_LAYER = 'radar-tracks-symbols'

const log = rlog('RadarClick')

/**
 * Wires click handling on the radar tracks map layer: clicking a hostile track
 * toggles tracking engagement for the active vehicle (click a different hostile
 * to switch targets, click the current target to disengage). Friendly tracks
 * are silently ignored.
 */
export function useRadarTrackInteractions(map: maplibregl.Map | null): void {
  const radarState = useRadarStore((s) => s.state)
  const scopeView = useRadarStore((s) => s.scopeView)
  const active = Boolean(radarState?.enabled) && scopeView === 'map'

  useEffect(() => {
    if (!map || !active) return

    const onClick = (e: maplibregl.MapLayerMouseEvent): void => {
      const feature = e.features?.[0]
      if (!feature || !feature.properties) return
      const affiliation = feature.properties.affiliation
      if (affiliation !== 'hostile') return
      const trackId = Number(feature.properties.id)
      if (!Number.isFinite(trackId)) return

      const activeVehicleId = useVehicleStore.getState().activeVehicleId
      if (activeVehicleId === null) return

      const currentTarget = useRadarStore.getState().trackedByVehicle.get(activeVehicleId)
      if (currentTarget === trackId) {
        window.bridge?.vehicleTrackingDisengage(activeVehicleId)
        log.log(`disengage request: vehicle=${activeVehicleId} track=${trackId}`)
      } else {
        window.bridge?.vehicleTrackingEngage(activeVehicleId, trackId).then((result) => {
          if (result && !result.ok) {
            useRadarStore.getState().setTrackingNotice({
              vehicleId: activeVehicleId,
              trackId,
              reason: 'engage-rejected',
              error: result.error,
              at: Date.now()
            })
            log.warn(`engage rejected: ${result.error ?? 'unknown'}`)
            setTimeout(() => {
              const current = useRadarStore.getState().trackingNotice
              if (current && current.trackId === trackId) {
                useRadarStore.getState().setTrackingNotice(null)
              }
            }, 4000)
          }
        })
        log.log(`engage request: vehicle=${activeVehicleId} track=${trackId}`)
      }
    }

    map.on('click', TRACKS_LAYER, onClick)
    return () => {
      map.off('click', TRACKS_LAYER, onClick)
    }
  }, [map, active])
}
