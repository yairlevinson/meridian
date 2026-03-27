import { MavLinkProtocolV2 } from 'node-mavlink'

export const GCS_SYSID = 255
export const GCS_COMPID = 190

export function createGcsProtocol(): MavLinkProtocolV2 {
  return new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
}
