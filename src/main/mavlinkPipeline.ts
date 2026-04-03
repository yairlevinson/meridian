import { PassThrough } from 'stream'
import { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkPacket } from 'node-mavlink'
import type { UdpLink } from './udpLink'
import { REGISTRY } from './mavlink/registry'
import { mavLog } from './mavlink/trafficLog'

export type DecodedMessage = {
  msgid: number
  sysid: number
  compid: number
  seq: number
  data: unknown
}

export function createPipeline(
  link: UdpLink,
  onMessage: (msg: DecodedMessage) => void
): () => void {
  const passthrough = new PassThrough()

  // NOTE: MavLinkPacketSplitter handles framing for byte streams (serial/TCP).
  // UDP delivers complete datagrams so framing is already handled by the OS.
  // If parse errors appear in testing, remove MavLinkPacketSplitter from the chain
  // and pipe UDP data directly into MavLinkPacketParser.
  const splitter = new MavLinkPacketSplitter()
  const parser = new MavLinkPacketParser()

  // Register CRC magic for messages not in mavlink-mappings
  const magicNumbers = (splitter as unknown as { magicNumbers: Record<number, number> }).magicNumbers
  magicNumbers[397] = 182 // COMPONENT_METADATA

  const reader = passthrough.pipe(splitter).pipe(parser)

  const dataHandler = (buf: Buffer): void => {
    passthrough.write(buf)
  }
  link.on('data', dataHandler)

  reader.on('data', (packet: MavLinkPacket) => {
    const messageClass = REGISTRY[packet.header.msgid]
    if (messageClass) {
      try {
        const data = packet.protocol.data(packet.payload, messageClass)
        mavLog.rx(packet.header.msgid, packet.header.sysid, packet.header.compid, data)
        onMessage({
          msgid: packet.header.msgid,
          sysid: packet.header.sysid,
          compid: packet.header.compid,
          seq: packet.header.seq,
          data
        })
      } catch (err) {
        mavLog.warn('pipeline', `failed to decode msgid=${packet.header.msgid}: ${(err as Error).message}`)
      }
    } else {
      // Unknown message — pass raw payload so handlers can decode manually
      mavLog.rx(packet.header.msgid, packet.header.sysid, packet.header.compid, null)
      onMessage({
        msgid: packet.header.msgid,
        sysid: packet.header.sysid,
        compid: packet.header.compid,
        seq: packet.header.seq,
        data: { _rawPayload: packet.payload }
      })
    }
  })

  splitter.on('error', (err) => mavLog.warn('pipeline', `splitter error: ${err.message}`))
  parser.on('error', (err) => mavLog.warn('pipeline', `parser error: ${(err as Error).message}`))

  // Return a cleanup function
  return () => {
    link.off('data', dataHandler)
    passthrough.destroy()
  }
}
