// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DeltaGroup } from '../src/main/state/DeltaGroup'

interface ScalarGroup {
  a: number
  b: string
  seq: number
}

interface ArrayGroup {
  items: number[]
  seq: number
}

describe('DeltaGroup', () => {
  describe('initial state', () => {
    it('starts clean with seq 0', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      expect(g.dirty).toBe(false)
      expect(g.seq).toBe(0)
    })

    it('snapshot returns initial value copy, not the constructor argument', () => {
      const initial: ScalarGroup = { a: 1, b: 'x', seq: 0 }
      const g = new DeltaGroup<ScalarGroup>(initial)
      const snap = g.snapshot()
      snap.a = 999
      expect(g.snapshot().a).toBe(1)
    })

    it('mutating the initial argument does not leak into the group', () => {
      const initial: ScalarGroup = { a: 1, b: 'x', seq: 0 }
      const g = new DeltaGroup<ScalarGroup>(initial)
      initial.a = 999
      expect(g.snapshot().a).toBe(1)
    })
  })

  describe('update (unconditional)', () => {
    it('bumps seq + sets dirty on every call', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      g.update({ a: 5 })
      expect(g.seq).toBe(1)
      expect(g.dirty).toBe(true)
      g.update({ a: 5 }) // same value
      expect(g.seq).toBe(2)
    })

    it('applies patched fields', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      g.update({ a: 7, b: 'hello' })
      expect(g.snapshot()).toMatchObject({ a: 7, b: 'hello', seq: 1 })
    })
  })

  describe('updateIfChanged (guarded)', () => {
    it('does not bump when no field differs (Object.is)', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 5, b: 'x', seq: 0 })
      g.updateIfChanged({ a: 5, b: 'x' })
      expect(g.seq).toBe(0)
      expect(g.dirty).toBe(false)
    })

    it('bumps when at least one field differs', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 5, b: 'x', seq: 0 })
      g.updateIfChanged({ a: 5, b: 'y' })
      expect(g.seq).toBe(1)
      expect(g.dirty).toBe(true)
    })

    it('NaN is treated as equal to NaN (Object.is semantics)', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: NaN, b: '', seq: 0 })
      g.updateIfChanged({ a: NaN })
      expect(g.seq).toBe(0)
    })
  })

  describe('takeDelta / snapshot', () => {
    it('takeDelta returns null when not dirty', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      expect(g.takeDelta()).toBeNull()
    })

    it('takeDelta returns snapshot and clears dirty', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      g.update({ a: 1 })
      expect(g.dirty).toBe(true)
      const d = g.takeDelta()
      expect(d).toMatchObject({ a: 1, seq: 1 })
      expect(g.dirty).toBe(false)
      expect(g.takeDelta()).toBeNull()
    })

    it('snapshot does not clear dirty', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      g.update({ a: 1 })
      g.snapshot()
      expect(g.dirty).toBe(true)
    })

    it('takeDelta returned object is independent of internal state (default clone)', () => {
      const g = new DeltaGroup<ScalarGroup>({ a: 0, b: '', seq: 0 })
      g.update({ a: 1 })
      const d = g.takeDelta()!
      d.a = 999
      expect(g.snapshot().a).toBe(1)
    })
  })

  describe('array-valued groups with custom clone', () => {
    it('snapshot returns deep-copied array', () => {
      const g = new DeltaGroup<ArrayGroup>({ items: [], seq: 0 }, (v) => ({
        ...v,
        items: [...v.items]
      }))
      g.update({ items: [1, 2, 3] })
      const snap = g.snapshot()
      snap.items.push(4)
      expect(g.snapshot().items).toEqual([1, 2, 3])
    })

    it('takeDelta returns deep-copied array', () => {
      const g = new DeltaGroup<ArrayGroup>({ items: [], seq: 0 }, (v) => ({
        ...v,
        items: [...v.items]
      }))
      g.update({ items: [1, 2] })
      const d1 = g.takeDelta()!
      d1.items.push(99)
      g.update({ items: [1, 2] })
      const d2 = g.takeDelta()!
      expect(d2.items).toEqual([1, 2])
    })
  })
})
