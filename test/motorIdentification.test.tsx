// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MotorIdentification } from '../src/renderer/src/setupview/actuators/MotorIdentification'

// Mock window.bridge
const mockMotorTest = vi.fn()
const mockBridge = {
  actuatorMotorTest: mockMotorTest,
  setParameter: vi.fn(),
  actuatorServoTest: vi.fn()
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(window as any).bridge = mockBridge
  mockMotorTest.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as any).bridge
})

describe('MotorIdentification — initial state', () => {
  it('shows "Identify Motors" button when not running', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    expect(screen.getByText('Identify Motors')).toBeTruthy()
    expect(screen.getByText(/Spin motors one at a time/)).toBeTruthy()
  })

  it('disables button when disabled prop is true', () => {
    render(<MotorIdentification motorCount={4} disabled={true} />)
    const btn = screen.getByText('Identify Motors') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('MotorIdentification — running wizard', () => {
  it('shows motor 1 of N after clicking Identify Motors', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Motor 1 of 4')).toBeTruthy()
  })

  it('shows SPINNING badge after starting', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('SPINNING')).toBeTruthy()
  })

  it('calls motorTest with motor 1 at 15% throttle on start', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    // motorTest is called through useActuatorTest which calls bridge.motorTest
    expect(mockMotorTest).toHaveBeenCalledWith(1, 1, 15, 3) // vehicleId=1, motor=1, throttle=15, timeout=3
  })

  it('removes SPINNING badge after spin duration (1500ms)', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('SPINNING')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(screen.queryByText('SPINNING')).toBeNull()
  })

  it('shows Spin Again, Next, and Stop controls when running', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Spin Again')).toBeTruthy()
    expect(screen.getByText('Next')).toBeTruthy()
    expect(screen.getByText('Stop')).toBeTruthy()
  })

  it('advances to next motor when clicking Next', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Motor 1 of 4')).toBeTruthy()

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Motor 2 of 4')).toBeTruthy()
  })

  it('calls motorTest for motor 2 after clicking Next', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    mockMotorTest.mockClear()

    fireEvent.click(screen.getByText('Next'))
    // stopAllMotors calls motorTest(vid, i, 0, 0) for each motor
    // then spinCurrent calls motorTest(vid, 2, 15, 3)
    const spinCall = mockMotorTest.mock.calls.find((c: number[]) => c[1] === 2 && c[2] === 15)
    expect(spinCall).toBeTruthy()
  })

  it('returns to initial state after clicking Stop', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Motor 1 of 4')).toBeTruthy()

    fireEvent.click(screen.getByText('Stop'))
    expect(screen.getByText('Identify Motors')).toBeTruthy()
    expect(screen.queryByText('Motor 1 of 4')).toBeNull()
  })

  it('re-spins current motor when clicking Spin Again', () => {
    render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    mockMotorTest.mockClear()

    // Wait for spin to finish
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    fireEvent.click(screen.getByText('Spin Again'))
    // Should call motorTest for motor 1 again
    const spinCall = mockMotorTest.mock.calls.find((c: number[]) => c[1] === 1 && c[2] === 15)
    expect(spinCall).toBeTruthy()
    expect(screen.getByText('SPINNING')).toBeTruthy()
  })

  it('finishes wizard after advancing past last motor', () => {
    render(<MotorIdentification motorCount={2} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Motor 1 of 2')).toBeTruthy()

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Motor 2 of 2')).toBeTruthy()

    fireEvent.click(screen.getByText('Next'))
    // Should return to initial state
    expect(screen.getByText('Identify Motors')).toBeTruthy()
  })
})

describe('MotorIdentification — auto-stop on disabled', () => {
  it('stops and resets when disabled becomes true mid-test', () => {
    const { rerender } = render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    expect(screen.getByText('Motor 1 of 4')).toBeTruthy()

    // Simulate vehicle becoming armed (disabled = true)
    rerender(<MotorIdentification motorCount={4} disabled={true} />)

    // Should return to initial non-running state
    expect(screen.getByText('Identify Motors')).toBeTruthy()
  })
})

describe('MotorIdentification — progress bar', () => {
  it('renders a progress bar element', () => {
    const { container } = render(<MotorIdentification motorCount={4} disabled={false} />)
    fireEvent.click(screen.getByText('Identify Motors'))
    // Progress bar fill element should exist
    const fills = container.querySelectorAll('[class*="identifyProgressFill"]')
    expect(fills.length).toBeGreaterThan(0)
  })
})
