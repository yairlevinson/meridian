// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import { MockLink } from '../src/test-utils/MockLink/MockLink'

describe('MAVLink Console', () => {
  let vehicle: Vehicle
  let link: MockLink

  beforeEach(() => {
    vehicle = new Vehicle(1)
    link = new MockLink()
    vehicle.setCommandLink(link)
  })

  afterEach(() => {
    vehicle.destroy()
  })

  describe('sendConsoleText', () => {
    it('sends a SERIAL_CONTROL message with DEV_SHELL', () => {
      vehicle.sendConsoleText('help')
      expect(link.sentBuffers.length).toBe(1)
      // Buffer was written — we can verify it's non-empty
      expect(link.sentBuffers[0]!.length).toBeGreaterThan(0)
    })

    it('appends newline if missing', () => {
      vehicle.sendConsoleText('help')
      const buf = link.sentBuffers[0]!
      // The serialized MAVLink message contains the text — find "help\n" in the payload
      const payloadStr = buf.toString('latin1')
      expect(payloadStr).toContain('help\n')
    })

    it('does not double-append newline', () => {
      vehicle.sendConsoleText('help\n')
      const buf = link.sentBuffers[0]!
      const payloadStr = buf.toString('latin1')
      // Should contain "help\n" but not "help\n\n"
      expect(payloadStr).toContain('help\n')
      expect(payloadStr).not.toContain('help\n\n')
    })

    it('splits messages longer than 70 bytes', () => {
      // Create a string that's >70 bytes (after adding \n)
      const longCmd = 'x'.repeat(100)
      vehicle.sendConsoleText(longCmd)
      // 101 bytes (100 + \n) should split into 2 messages (70 + 31)
      expect(link.sentBuffers.length).toBe(2)
    })

    it('does nothing without a link', () => {
      const unlinkedVehicle = new Vehicle(2)
      // No link set — should not throw
      expect(() => unlinkedVehicle.sendConsoleText('help')).not.toThrow()
      unlinkedVehicle.destroy()
    })
  })

  describe('handleMessage — SERIAL_CONTROL (126)', () => {
    it('emits consoleData for DEV_SHELL messages', () => {
      const handler = vi.fn()
      vehicle.on('consoleData', handler)

      const text = 'nsh> '
      const data = Array.from(Buffer.from(text))
      vehicle.handleMessage(
        {
          msgid: 126,
          sysid: 1,
          compid: 1,
          seq: 0,
          data: { device: 10, flags: 1, count: data.length, data }
        },
        'link-0'
      )

      expect(handler).toHaveBeenCalledWith({ text: 'nsh> ' })
    })

    it('ignores non-DEV_SHELL messages', () => {
      const handler = vi.fn()
      vehicle.on('consoleData', handler)

      vehicle.handleMessage(
        {
          msgid: 126,
          sysid: 1,
          compid: 1,
          seq: 0,
          data: { device: 0, flags: 1, count: 5, data: [104, 101, 108, 108, 111] }
        },
        'link-0'
      )

      expect(handler).not.toHaveBeenCalled()
    })

    it('respects count field and ignores padding bytes', () => {
      const handler = vi.fn()
      vehicle.on('consoleData', handler)

      // "hi" is 2 bytes, but data array is padded to 70
      const dataArr = Array.from({ length: 70 }, (_, i) => (i < 2 ? [104, 105][i]! : 0))
      vehicle.handleMessage(
        {
          msgid: 126,
          sysid: 1,
          compid: 1,
          seq: 0,
          data: { device: 10, flags: 1, count: 2, data: dataArr }
        },
        'link-0'
      )

      expect(handler).toHaveBeenCalledWith({ text: 'hi' })
    })

    it('does not emit for empty text', () => {
      const handler = vi.fn()
      vehicle.on('consoleData', handler)

      vehicle.handleMessage(
        {
          msgid: 126,
          sysid: 1,
          compid: 1,
          seq: 0,
          data: { device: 10, flags: 1, count: 0, data: [] }
        },
        'link-0'
      )

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
