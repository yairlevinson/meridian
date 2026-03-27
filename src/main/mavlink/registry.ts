import { common, minimal } from 'mavlink-mappings'
import type { MavLinkData, MavLinkDataConstructor } from 'node-mavlink'

export const REGISTRY: Record<number, MavLinkDataConstructor<MavLinkData>> = {
  ...minimal.REGISTRY,
  ...common.REGISTRY
} as Record<number, MavLinkDataConstructor<MavLinkData>>
