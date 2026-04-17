/** Erased interface so heterogeneous DeltaGroups can share a registry. */
export interface IDeltaGroup {
  readonly dirty: boolean
  readonly seq: number
  snapshot(): { seq: number }
  takeDelta(): { seq: number } | null
}

/**
 * A single group of delta-tracked state.
 *
 * Holds a mutable record with a `seq` counter that auto-increments when any
 * field changes (per Object.is comparison). `takeDelta()` returns the current
 * value and clears the dirty flag; `snapshot()` returns a copy without
 * clearing. Group types that contain nested arrays or objects must supply a
 * `clone` function so snapshots don't share references with internal state.
 */
export class DeltaGroup<T extends { seq: number }> implements IDeltaGroup {
  private current: T
  private _dirty = false
  private readonly _clone: (v: T) => T

  constructor(initial: T, clone?: (v: T) => T) {
    this._clone = clone ?? ((v) => ({ ...v }))
    this.current = this._clone(initial)
  }

  /**
   * Apply a patch and always bump `seq` + dirty. Use for message handlers
   * where receiving a packet counts as fresh data regardless of content.
   */
  update(patch: Partial<Omit<T, 'seq'>>): void {
    for (const key in patch) {
      ;(this.current as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
    }
    this.current.seq++
    this._dirty = true
  }

  /**
   * Apply a patch only if at least one field differs (Object.is). Use for
   * explicit setters where identical calls should be idempotent.
   */
  updateIfChanged(patch: Partial<Omit<T, 'seq'>>): void {
    let changed = false
    for (const key in patch) {
      const v = (patch as Record<string, unknown>)[key]
      if (!Object.is((this.current as Record<string, unknown>)[key], v)) {
        ;(this.current as Record<string, unknown>)[key] = v
        changed = true
      }
    }
    if (changed) {
      this.current.seq++
      this._dirty = true
    }
  }

  get dirty(): boolean {
    return this._dirty
  }

  get seq(): number {
    return this.current.seq
  }

  snapshot(): T {
    return this._clone(this.current)
  }

  /** Returns a snapshot if dirty and clears the flag; null otherwise. */
  takeDelta(): T | null {
    if (!this._dirty) return null
    this._dirty = false
    return this.snapshot()
  }
}
