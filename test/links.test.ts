// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import dgram from 'dgram'
import { UdpLink } from '../src/main/links/UdpLink'
import { LinkType } from '../src/shared-types/ipc/LinkState'

describe('UdpLink', () => {
  let link: UdpLink | null = null

  afterEach(() => {
    link?.disconnect()
    link = null
  })

  it('connects and receives data via loopback', async () => {
    link = new UdpLink('test-udp', {
      type: LinkType.UDP,
      name: 'Test UDP',
      listenPort: 0 // random port
    })

    await link.connect()
    expect(link.isConnected).toBe(true)

    // Discover actual port (bind to 0 = random)
    const address = (link as any).socket.address()

    const sender = dgram.createSocket('udp4')
    const testData = Buffer.from([0xfd, 1, 2, 3])

    const received = new Promise<Buffer>((resolve) => {
      link!.on('data', resolve)
    })

    sender.send(testData, address.port, '127.0.0.1')

    const buf = await received
    expect(buf).toEqual(testData)
    sender.close()
  })
})
