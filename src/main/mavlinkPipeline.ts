import { PassThrough } from 'stream'
import { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkPacket } from 'node-mavlink'
import type { UdpLink } from './udpLink'
import { REGISTRY } from './mavlink/registry'

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
  const reader = passthrough.pipe(splitter).pipe(parser)

  const dataHandler = (buf: Buffer): void => {
    passthrough.write(buf)
  }
  link.on('data', dataHandler)

  reader.on('data', (packet: MavLinkPacket) => {
    const messageClass = REGISTRY[packet.header.msgid]
    if (!messageClass) return
    try {
      const data = packet.protocol.data(packet.payload, messageClass)
      onMessage({
        msgid: packet.header.msgid,
        sysid: packet.header.sysid,
        compid: packet.header.compid,
        seq: packet.header.seq,
        data
      })
    } catch (err) {
      console.warn(`[pipeline] failed to decode msgid=${packet.header.msgid}:`, err)
    }
  })

  splitter.on('error', (err) => console.warn('[pipeline] splitter error:', err.message))
  parser.on('error', (err) => console.warn('[pipeline] parser error:', err.message))

  // Return a cleanup function
  return () => {
    link.off('data', dataHandler)
    passthrough.destroy()
  }
}
