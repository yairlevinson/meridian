// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RcCalibrationManager } from '../src/main/calibration/RcCalibrationManager'
import { RcCalStep } from '../src/shared-types/ipc/SetupTypes'

/** Minimal mock for ParameterManager.setParameter() */
function createMockParameterManager() {
  return {
    setParameter: vi.fn()
  }
}

describe('RcCalibrationManager', () => {
  let mgr: RcCalibrationManager

  beforeEach(() => {
    mgr = new RcCalibrationManager()
  })

  // --- Lifecycle ---

  it('starts in Idle state', () => {
    expect(mgr.state.step).toBe(RcCalStep.Idle)
    expect(mgr.state.channelCount).toBe(0)
  })

  it('transitions to Center on start()', () => {
    mgr.start()
    expect(mgr.state.step).toBe(RcCalStep.Center)
  })

  it('emits stateChanged on start', () => {
    const spy = vi.fn()
    mgr.on('stateChanged', spy)
    mgr.start()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('resets state on start', () => {
    // Populate some state first
    mgr.start()
    mgr.updateChannels([1500, 1500], 2)
    mgr.nextStep() // -> DetectSticks

    // Start fresh
    mgr.start()
    expect(mgr.state.step).toBe(RcCalStep.Center)
    expect(mgr.state.stickMapping.roll).toBeNull()
  })

  // --- Step progression ---

  describe('nextStep()', () => {
    beforeEach(() => {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
    })

    it('Center -> DetectSticks (roll)', () => {
      mgr.nextStep()
      expect(mgr.state.step).toBe(RcCalStep.DetectSticks)
    })

    it('DetectSticks cycles through roll -> pitch -> yaw -> throttle -> MinMax', () => {
      mgr.nextStep() // -> DetectSticks (roll)
      expect(mgr.state.step).toBe(RcCalStep.DetectSticks)

      mgr.nextStep() // -> pitch
      expect(mgr.state.step).toBe(RcCalStep.DetectSticks)

      mgr.nextStep() // -> yaw
      expect(mgr.state.step).toBe(RcCalStep.DetectSticks)

      mgr.nextStep() // -> throttle
      expect(mgr.state.step).toBe(RcCalStep.DetectSticks)

      mgr.nextStep() // -> MinMax
      expect(mgr.state.step).toBe(RcCalStep.MinMax)
    })

    it('MinMax -> Complete', () => {
      mgr.nextStep() // DetectSticks
      mgr.nextStep() // pitch
      mgr.nextStep() // yaw
      mgr.nextStep() // throttle
      mgr.nextStep() // MinMax
      mgr.nextStep() // Complete
      expect(mgr.state.step).toBe(RcCalStep.Complete)
    })

    it('does nothing from Idle', () => {
      const idle = new RcCalibrationManager()
      idle.nextStep()
      expect(idle.state.step).toBe(RcCalStep.Idle)
    })
  })

  // --- Cancel ---

  it('cancel resets to Idle', () => {
    mgr.start()
    mgr.cancel()
    expect(mgr.state.step).toBe(RcCalStep.Idle)
    expect(Object.keys(mgr.state.channels)).toHaveLength(0)
  })

  // --- Channel updates ---

  describe('updateChannels()', () => {
    it('tracks channel count', () => {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500], 8)
      expect(mgr.state.channelCount).toBe(8)
    })

    it('creates channel entries with current values', () => {
      mgr.start()
      mgr.updateChannels([1200, 1800], 2)
      expect(mgr.state.channels[0]?.currentValue).toBe(1200)
      expect(mgr.state.channels[1]?.currentValue).toBe(1800)
    })

    it('does not emit state when Idle', () => {
      const spy = vi.fn()
      mgr.on('stateChanged', spy)
      mgr.updateChannels([1500], 1)
      expect(spy).not.toHaveBeenCalled()
    })

    it('emits state during active calibration', () => {
      mgr.start()
      const spy = vi.fn()
      mgr.on('stateChanged', spy)
      mgr.updateChannels([1500], 1)
      expect(spy).toHaveBeenCalled()
    })
  })

  // --- Trim recording (Center -> DetectSticks) ---

  describe('trim recording', () => {
    it('records current values as trim when advancing from Center', () => {
      mgr.start()
      mgr.updateChannels([1480, 1520, 1500, 1510], 4)
      mgr.nextStep() // Center -> DetectSticks, records trims

      // Channels should be re-initialized with trim values
      const ch0 = mgr.state.channels[0]
      expect(ch0?.trim).toBe(1480)
      expect(ch0?.min).toBe(1480)
      expect(ch0?.max).toBe(1480)
    })
  })

  // --- MinMax tracking ---

  describe('MinMax step', () => {
    function advanceToMinMax() {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // -> DetectSticks
      mgr.nextStep() // pitch
      mgr.nextStep() // yaw
      mgr.nextStep() // throttle
      mgr.nextStep() // -> MinMax
    }

    it('tracks min/max during MinMax step', () => {
      advanceToMinMax()

      mgr.updateChannels([1100, 1500, 1500, 1500], 4)
      mgr.updateChannels([1900, 1500, 1500, 1500], 4)

      const ch0 = mgr.state.channels[0]
      expect(ch0?.min).toBe(1100)
      expect(ch0?.max).toBe(1900)
    })

    it('does not track min/max outside MinMax step', () => {
      mgr.start()
      mgr.updateChannels([1500, 1500], 2)
      mgr.nextStep() // DetectSticks

      // Send extreme values during DetectSticks
      mgr.updateChannels([1000, 1500], 2)
      mgr.updateChannels([2000, 1500], 2)

      // Channel 0 min/max should still be the trim from Center step
      const ch0 = mgr.state.channels[0]
      expect(ch0?.min).toBe(1500)
      expect(ch0?.max).toBe(1500)
    })
  })

  // --- Stick detection ---

  describe('stick detection', () => {
    it('maps a stick when channel deflects beyond threshold', () => {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // -> DetectSticks, currentStick = roll

      // Deflect channel 0 beyond threshold (100 PWM)
      mgr.updateChannels([1650, 1500, 1500, 1500], 4)

      expect(mgr.state.stickMapping.roll).toBe(0)
    })

    it('does not map a channel already assigned to another stick', () => {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // DetectSticks, roll

      // Map channel 0 to roll
      mgr.updateChannels([1650, 1500, 1500, 1500], 4)
      expect(mgr.state.stickMapping.roll).toBe(0)

      mgr.nextStep() // -> pitch

      // Try to map channel 0 to pitch too — should be rejected
      mgr.updateChannels([1650, 1500, 1500, 1500], 4)
      expect(mgr.state.stickMapping.pitch).toBeNull()

      // Map channel 1 to pitch instead
      mgr.updateChannels([1650, 1650, 1500, 1500], 4)
      expect(mgr.state.stickMapping.pitch).toBe(1)
    })

    it('does not detect sticks below threshold', () => {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // DetectSticks

      // Deflect channel 0 by only 50 (below 100 threshold)
      mgr.updateChannels([1550, 1500, 1500, 1500], 4)
      expect(mgr.state.stickMapping.roll).toBeNull()
    })
  })

  // --- Save ---

  describe('save()', () => {
    it('does nothing without a parameter manager', async () => {
      mgr.start()
      // Can't really assert much, just ensure no throw
      await mgr.save()
    })

    it('does nothing if not in Complete step', async () => {
      const pm = createMockParameterManager()
      mgr.setParameterManager(pm as any)
      mgr.start()
      await mgr.save()
      expect(pm.setParameter).not.toHaveBeenCalled()
    })

    it('writes RC params and RCMAP params on save', async () => {
      const pm = createMockParameterManager()
      mgr.setParameterManager(pm as any)

      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // DetectSticks

      // Detect all sticks
      mgr.updateChannels([1700, 1500, 1500, 1500], 4) // roll -> ch0
      mgr.nextStep() // pitch
      mgr.updateChannels([1500, 1700, 1500, 1500], 4) // pitch -> ch1
      mgr.nextStep() // yaw
      mgr.updateChannels([1500, 1500, 1700, 1500], 4) // yaw -> ch2
      mgr.nextStep() // throttle
      mgr.updateChannels([1500, 1500, 1500, 1700], 4) // throttle -> ch3
      mgr.nextStep() // MinMax

      // Move sticks to extremes
      mgr.updateChannels([1000, 1100, 1200, 1300], 4)
      mgr.updateChannels([2000, 1900, 1800, 1700], 4)

      mgr.nextStep() // Complete

      await mgr.save()

      // RC1_MIN through RC4_MIN
      expect(pm.setParameter).toHaveBeenCalledWith('RC1_MIN', 1000)
      expect(pm.setParameter).toHaveBeenCalledWith('RC1_MAX', 2000)
      expect(pm.setParameter).toHaveBeenCalledWith('RC1_TRIM', 1500)
      expect(pm.setParameter).toHaveBeenCalledWith('RC1_REVERSED', 0)

      expect(pm.setParameter).toHaveBeenCalledWith('RC2_MIN', 1100)
      expect(pm.setParameter).toHaveBeenCalledWith('RC2_MAX', 1900)

      // RCMAP (1-indexed channels)
      expect(pm.setParameter).toHaveBeenCalledWith('RCMAP_ROLL', 1) // ch0 + 1
      expect(pm.setParameter).toHaveBeenCalledWith('RCMAP_PITCH', 2)
      expect(pm.setParameter).toHaveBeenCalledWith('RCMAP_YAW', 3)
      expect(pm.setParameter).toHaveBeenCalledWith('RCMAP_THROTTLE', 4)

      // Should return to Idle after save
      expect(mgr.state.step).toBe(RcCalStep.Idle)
    })

    it('skips RCMAP for unmapped sticks', async () => {
      const pm = createMockParameterManager()
      mgr.setParameterManager(pm as any)

      mgr.start()
      mgr.updateChannels([1500, 1500], 2)
      mgr.nextStep() // DetectSticks
      // Don't detect any sticks — skip through
      mgr.nextStep() // pitch
      mgr.nextStep() // yaw
      mgr.nextStep() // throttle
      mgr.nextStep() // MinMax
      mgr.nextStep() // Complete

      await mgr.save()

      const calls = pm.setParameter.mock.calls.map((c: any) => c[0])
      expect(calls).not.toContain('RCMAP_ROLL')
      expect(calls).not.toContain('RCMAP_PITCH')
    })
  })

  // --- Reversal detection ---

  describe('reversal detection during MinMax', () => {
    function advanceToMinMaxWithSticks() {
      mgr.start()
      mgr.updateChannels([1500, 1500, 1500, 1500], 4)
      mgr.nextStep() // -> DetectSticks (roll)

      // Map ch0=roll, ch1=pitch, ch2=yaw, ch3=throttle
      mgr.updateChannels([1700, 1500, 1500, 1500], 4) // roll -> ch0
      mgr.nextStep() // pitch
      mgr.updateChannels([1500, 1700, 1500, 1500], 4) // pitch -> ch1
      mgr.nextStep() // yaw
      mgr.updateChannels([1500, 1500, 1700, 1500], 4) // yaw -> ch2
      mgr.nextStep() // throttle
      mgr.updateChannels([1500, 1500, 1500, 1700], 4) // throttle -> ch3
      mgr.nextStep() // -> MinMax
      expect(mgr.state.step).toBe(RcCalStep.MinMax)
    }

    it('detects a reversed channel when more range below trim', () => {
      advanceToMinMaxWithSticks()

      // Ch0 (roll): move mostly below trim -> reversed
      mgr.updateChannels([1100, 1500, 1500, 1500], 4) // 400 below trim
      mgr.updateChannels([1550, 1500, 1500, 1500], 4) // only 50 above trim

      const ch0 = mgr.state.channels[0]
      expect(ch0?.reversed).toBe(true)
    })

    it('does not mark reversed when more range above trim', () => {
      advanceToMinMaxWithSticks()

      // Ch0 (roll): move mostly above trim -> normal
      mgr.updateChannels([1450, 1500, 1500, 1500], 4) // only 50 below trim
      mgr.updateChannels([1900, 1500, 1500, 1500], 4) // 400 above trim

      const ch0 = mgr.state.channels[0]
      expect(ch0?.reversed).toBe(false)
    })

    it('does not detect reversal for unmapped channels', () => {
      advanceToMinMaxWithSticks()

      // Create a 5th channel (unmapped) with asymmetric range
      mgr.updateChannels([1500, 1500, 1500, 1500, 1100], 5)
      mgr.updateChannels([1500, 1500, 1500, 1500, 1520], 5)

      // Channel 4 is not mapped to any stick, should stay at default (false)
      const ch4 = mgr.state.channels[4]
      expect(ch4?.reversed).toBe(false)
    })

    it('does not detect reversal when range is below threshold', () => {
      advanceToMinMaxWithSticks()

      // Small movements only (below 2 * STICK_DETECT_THRESHOLD = 200)
      mgr.updateChannels([1420, 1500, 1500, 1500], 4) // 80 below
      mgr.updateChannels([1510, 1500, 1500, 1500], 4) // 10 above
      // Total range = 90, below 200 threshold

      const ch0 = mgr.state.channels[0]
      expect(ch0?.reversed).toBe(false)
    })

    it('saves reversed flag via parameter manager', async () => {
      const pm = createMockParameterManager()
      mgr.setParameterManager(pm as any)
      advanceToMinMaxWithSticks()

      // Make ch0 reversed
      mgr.updateChannels([1100, 1500, 1500, 1500], 4)
      mgr.updateChannels([1550, 1500, 1500, 1500], 4)

      mgr.nextStep() // -> Complete
      await mgr.save()

      expect(pm.setParameter).toHaveBeenCalledWith('RC1_REVERSED', 1)
    })
  })

  // --- state returns a copy ---

  it('returns a defensive copy of state', () => {
    mgr.start()
    const s1 = mgr.state
    const s2 = mgr.state
    expect(s1).not.toBe(s2)
    expect(s1).toEqual(s2)
  })

  // --- destroy ---

  it('removes all listeners on destroy', () => {
    const spy = vi.fn()
    mgr.on('stateChanged', spy)
    mgr.destroy()
    mgr.start()
    expect(spy).not.toHaveBeenCalled()
  })

  // --- MAX_CHANNELS limit ---

  it('limits to 16 channels', () => {
    mgr.start()
    const channels = Array.from({ length: 20 }, () => 1500)
    mgr.updateChannels(channels, 20)
    // Should only track 16 channels
    expect(Object.keys(mgr.state.channels).length).toBe(16)
  })
})
