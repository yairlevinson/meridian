import { EventEmitter } from 'events'

/**
 * Abstract radar data provider.
 *
 * Emits:
 *  - 'unitUpdate'    (RadarUnit)   — radar unit position updated
 *  - 'trackUpdate'   (RadarTrack)  — a tracked object updated
 *  - 'trackRemoved'  (trackId: number) — a tracked object removed
 */
export abstract class RadarProvider extends EventEmitter {
  abstract start(): void
  abstract stop(): void
  abstract destroy(): void
}
