// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { firmwareFileToBase64 } from '../src/renderer/src/setupview/firmware/firmwareFile'

describe('browser firmware files', () => {
  it('encodes selected firmware files for RPC upload', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 253, 254, 255])], 'firmware.bin')

    await expect(firmwareFileToBase64(file)).resolves.toBe('AAEC/f7/')
  })
})
