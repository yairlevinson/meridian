// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  getMotorLayout,
  getPx4MotorLayout,
  QUAD_X,
  QUAD_PLUS,
  HEXA_X,
  HEXA_PLUS,
  OCTA_X,
  Y6,
  TRI,
  PX4_QUAD_X,
  PX4_QUAD_PLUS,
  PX4_HEXA_X,
  PX4_HEXA_PLUS,
  FRAME_CLASS_NAMES,
  FRAME_TYPE_NAMES
} from '../src/renderer/src/setupview/actuators/motorLayouts'

describe('Motor layouts — getMotorLayout', () => {
  // --- Quad ---

  it('returns QUAD_PLUS for frameClass=1, frameType=0', () => {
    expect(getMotorLayout(1, 0)).toBe(QUAD_PLUS)
  })

  it('returns QUAD_X for frameClass=1, frameType=1', () => {
    expect(getMotorLayout(1, 1)).toBe(QUAD_X)
  })

  it('defaults to QUAD_X for frameClass=1 with non-plus frameType', () => {
    expect(getMotorLayout(1, 2)).toBe(QUAD_X)
    expect(getMotorLayout(1, 3)).toBe(QUAD_X)
  })

  // --- Hexa ---

  it('returns HEXA_PLUS for frameClass=2, frameType=0', () => {
    expect(getMotorLayout(2, 0)).toBe(HEXA_PLUS)
  })

  it('returns HEXA_X for frameClass=2, frameType=1', () => {
    expect(getMotorLayout(2, 1)).toBe(HEXA_X)
  })

  // --- Octa ---

  it('returns OCTA_X for frameClass=3', () => {
    expect(getMotorLayout(3, 0)).toBe(OCTA_X)
    expect(getMotorLayout(3, 1)).toBe(OCTA_X)
  })

  // --- Y6 ---

  it('returns Y6 for frameClass=5', () => {
    expect(getMotorLayout(5, 0)).toBe(Y6)
    expect(getMotorLayout(5, 1)).toBe(Y6)
  })

  // --- Tri ---

  it('returns TRI for frameClass=7', () => {
    expect(getMotorLayout(7, 0)).toBe(TRI)
  })

  // --- Unknown ---

  it('returns null for unknown frame classes', () => {
    expect(getMotorLayout(0, 0)).toBeNull()
    expect(getMotorLayout(6, 0)).toBeNull() // Heli — no diagram
    expect(getMotorLayout(99, 0)).toBeNull()
  })
})

describe('Motor layouts — Quad X correctness', () => {
  it('has 4 motors', () => {
    expect(QUAD_X).toHaveLength(4)
  })

  it('motors are labeled 1-4', () => {
    const labels = QUAD_X.map((m) => m.label).sort()
    expect(labels).toEqual(['1', '2', '3', '4'])
  })

  it('has alternating CW/CCW spin (2 CW + 2 CCW)', () => {
    const cwCount = QUAD_X.filter((m) => m.cw).length
    const ccwCount = QUAD_X.filter((m) => !m.cw).length
    expect(cwCount).toBe(2)
    expect(ccwCount).toBe(2)
  })

  it('motor 1 (front-right) is CCW', () => {
    const m1 = QUAD_X.find((m) => m.label === '1')!
    expect(m1.cw).toBe(false)
    expect(m1.x).toBeGreaterThan(50) // right side
    expect(m1.y).toBeLessThan(50) // front (top)
  })

  it('motor 3 (front-left) is CW', () => {
    const m3 = QUAD_X.find((m) => m.label === '3')!
    expect(m3.cw).toBe(true)
    expect(m3.x).toBeLessThan(50) // left side
    expect(m3.y).toBeLessThan(50) // front (top)
  })

  it('motor 4 (rear-right) is CW', () => {
    const m4 = QUAD_X.find((m) => m.label === '4')!
    expect(m4.cw).toBe(true)
    expect(m4.x).toBeGreaterThan(50) // right side
    expect(m4.y).toBeGreaterThan(50) // rear (bottom)
  })
})

describe('Motor layouts — Quad Plus correctness', () => {
  it('has 4 motors', () => {
    expect(QUAD_PLUS).toHaveLength(4)
  })

  it('motor 1 (front) is at top center', () => {
    const m1 = QUAD_PLUS.find((m) => m.label === '1')!
    expect(m1.x).toBe(50)
    expect(m1.y).toBeLessThan(50)
  })

  it('motor 2 (rear) is at bottom center', () => {
    const m2 = QUAD_PLUS.find((m) => m.label === '2')!
    expect(m2.x).toBe(50)
    expect(m2.y).toBeGreaterThan(50)
  })
})

describe('Motor layouts — Hexa X correctness', () => {
  it('has 6 motors', () => {
    expect(HEXA_X).toHaveLength(6)
  })

  it('has 3 CW and 3 CCW motors', () => {
    const cwCount = HEXA_X.filter((m) => m.cw).length
    expect(cwCount).toBe(3)
  })

  it('motors are labeled 1-6', () => {
    const labels = HEXA_X.map((m) => m.label).sort()
    expect(labels).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('Motor layouts — Octa X correctness', () => {
  it('has 8 motors', () => {
    expect(OCTA_X).toHaveLength(8)
  })

  it('has 4 CW and 4 CCW motors', () => {
    const cwCount = OCTA_X.filter((m) => m.cw).length
    expect(cwCount).toBe(4)
  })

  it('motors are labeled 1-8', () => {
    const labels = OCTA_X.map((m) => m.label).sort()
    expect(labels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
})

describe('Motor layouts — Y6 correctness', () => {
  it('has 6 motors (3 coaxial pairs)', () => {
    expect(Y6).toHaveLength(6)
  })

  it('coaxial motors share positions (1&4, 2&5, 3&6)', () => {
    const m1 = Y6.find((m) => m.label === '1')!
    const m4 = Y6.find((m) => m.label === '4')!
    expect(m1.x).toBe(m4.x)
    expect(m1.y).toBe(m4.y)

    const m2 = Y6.find((m) => m.label === '2')!
    const m5 = Y6.find((m) => m.label === '5')!
    expect(m2.x).toBe(m5.x)
    expect(m2.y).toBe(m5.y)
  })

  it('coaxial pairs have opposite spin directions', () => {
    const m1 = Y6.find((m) => m.label === '1')!
    const m4 = Y6.find((m) => m.label === '4')!
    expect(m1.cw).not.toBe(m4.cw)

    const m2 = Y6.find((m) => m.label === '2')!
    const m5 = Y6.find((m) => m.label === '5')!
    expect(m2.cw).not.toBe(m5.cw)
  })
})

describe('Motor layouts — Tri correctness', () => {
  it('has 3 motors', () => {
    expect(TRI).toHaveLength(3)
  })

  it('uses motor labels 1, 2, 4 (3 is yaw servo in ArduPilot)', () => {
    const labels = TRI.map((m) => m.label).sort()
    expect(labels).toEqual(['1', '2', '4'])
  })
})

describe('Motor layouts — coordinate bounds', () => {
  const allLayouts = [QUAD_X, QUAD_PLUS, HEXA_X, HEXA_PLUS, OCTA_X, Y6, TRI]

  it('all motor positions are within 0-100 coordinate range', () => {
    for (const layout of allLayouts) {
      for (const motor of layout) {
        expect(motor.x).toBeGreaterThanOrEqual(0)
        expect(motor.x).toBeLessThanOrEqual(100)
        expect(motor.y).toBeGreaterThanOrEqual(0)
        expect(motor.y).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('Frame name lookups', () => {
  it('FRAME_CLASS_NAMES covers common classes', () => {
    expect(FRAME_CLASS_NAMES[1]).toBe('Quad')
    expect(FRAME_CLASS_NAMES[2]).toBe('Hexa')
    expect(FRAME_CLASS_NAMES[3]).toBe('Octa')
    expect(FRAME_CLASS_NAMES[7]).toBe('Tri')
  })

  it('FRAME_TYPE_NAMES covers common types', () => {
    expect(FRAME_TYPE_NAMES[0]).toBe('Plus (+)')
    expect(FRAME_TYPE_NAMES[1]).toBe('X')
  })
})

// --- PX4 layouts ---

describe('PX4 Motor layouts — getPx4MotorLayout', () => {
  it('returns Quad X for SYS_AUTOSTART=4001', () => {
    const result = getPx4MotorLayout(4001)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Quad X')
    expect(result!.layout).toBe(PX4_QUAD_X)
  })

  it('returns Quad X for any 4xxx value (default)', () => {
    expect(getPx4MotorLayout(4002)!.layout).toBe(PX4_QUAD_X)
    expect(getPx4MotorLayout(4500)!.layout).toBe(PX4_QUAD_X)
  })

  it('returns Quad + for SYS_AUTOSTART=4010', () => {
    const result = getPx4MotorLayout(4010)
    expect(result!.name).toBe('Quad +')
    expect(result!.layout).toBe(PX4_QUAD_PLUS)
  })

  it('returns Quad + for SYS_AUTOSTART=4011', () => {
    expect(getPx4MotorLayout(4011)!.layout).toBe(PX4_QUAD_PLUS)
  })

  it('returns Hexa X for SYS_AUTOSTART=6001', () => {
    const result = getPx4MotorLayout(6001)
    expect(result!.name).toBe('Hexa X')
    expect(result!.layout).toBe(PX4_HEXA_X)
  })

  it('returns Hexa + for SYS_AUTOSTART=6002', () => {
    const result = getPx4MotorLayout(6002)
    expect(result!.name).toBe('Hexa +')
    expect(result!.layout).toBe(PX4_HEXA_PLUS)
  })

  it('returns null for unknown airframe IDs', () => {
    expect(getPx4MotorLayout(0)).toBeNull()
    expect(getPx4MotorLayout(9999)).toBeNull()
    expect(getPx4MotorLayout(1000)).toBeNull()
  })
})

describe('PX4 Motor layouts — Quad X correctness', () => {
  it('has 4 motors', () => {
    expect(PX4_QUAD_X).toHaveLength(4)
  })

  it('motors are labeled 1-4', () => {
    const labels = PX4_QUAD_X.map((m) => m.label).sort()
    expect(labels).toEqual(['1', '2', '3', '4'])
  })

  it('has 2 CW and 2 CCW motors', () => {
    const cwCount = PX4_QUAD_X.filter((m) => m.cw).length
    expect(cwCount).toBe(2)
  })
})

describe('PX4 Motor layouts — Quad Plus correctness', () => {
  it('has 4 motors', () => {
    expect(PX4_QUAD_PLUS).toHaveLength(4)
  })

  it('motor 1 (front) is at top center', () => {
    const m1 = PX4_QUAD_PLUS.find((m) => m.label === '1')!
    expect(m1.x).toBe(50)
    expect(m1.y).toBeLessThan(50)
  })
})

describe('PX4 Motor layouts — Hexa correctness', () => {
  it('Hexa X has 6 motors with 3 CW and 3 CCW', () => {
    expect(PX4_HEXA_X).toHaveLength(6)
    expect(PX4_HEXA_X.filter((m) => m.cw).length).toBe(3)
  })

  it('Hexa Plus has 6 motors with 3 CW and 3 CCW', () => {
    expect(PX4_HEXA_PLUS).toHaveLength(6)
    expect(PX4_HEXA_PLUS.filter((m) => m.cw).length).toBe(3)
  })
})

describe('PX4 Motor layouts — coordinate bounds', () => {
  const px4Layouts = [PX4_QUAD_X, PX4_QUAD_PLUS, PX4_HEXA_X, PX4_HEXA_PLUS]

  it('all PX4 motor positions are within 0-100 coordinate range', () => {
    for (const layout of px4Layouts) {
      for (const motor of layout) {
        expect(motor.x).toBeGreaterThanOrEqual(0)
        expect(motor.x).toBeLessThanOrEqual(100)
        expect(motor.y).toBeGreaterThanOrEqual(0)
        expect(motor.y).toBeLessThanOrEqual(100)
      }
    }
  })
})
