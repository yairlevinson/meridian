// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useParameterStore } from '../src/renderer/src/store/parameterStore'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import { OutputConfigSection } from '../src/renderer/src/setupview/actuators/OutputConfigSection'
import { ParamValueType } from '../src/shared-types/ipc/ParameterTypes'
import type { Parameter } from '../src/shared-types/ipc/ParameterTypes'

function makeParam(name: string, value: number, index = 0): Parameter {
  return { name, value, type: ParamValueType.REAL32, index, componentId: 1 }
}

/** Set up parameter store with N servo channels having standard defaults */
function setupServoParams(channelCount: number): void {
  const params = new Map<string, Parameter>()
  for (let i = 1; i <= channelCount; i++) {
    params.set(`SERVO${i}_FUNCTION`, makeParam(`SERVO${i}_FUNCTION`, i <= 4 ? 32 + i : 0))
    params.set(`SERVO${i}_MIN`, makeParam(`SERVO${i}_MIN`, 1000))
    params.set(`SERVO${i}_MAX`, makeParam(`SERVO${i}_MAX`, 2000))
    params.set(`SERVO${i}_TRIM`, makeParam(`SERVO${i}_TRIM`, 1500))
    params.set(`SERVO${i}_REVERSED`, makeParam(`SERVO${i}_REVERSED`, 0))
  }
  useParameterStore.setState({
    parameters: params,
    loadState: {
      totalCount: channelCount * 5,
      receivedCount: channelCount * 5,
      loadProgress: 1,
      parametersReady: true,
      missingParameters: false,
      missingIndices: [],
      retryCount: 0,
      pendingWrites: 0
    }
  })
}

// Mock window.bridge
const mockSetParameter = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  ;(window as any).bridge = { setParameter: mockSetParameter }
  mockSetParameter.mockClear()
  useParameterStore.setState({
    parameters: new Map(),
    loadState: {
      totalCount: 0,
      receivedCount: 0,
      loadProgress: 0,
      parametersReady: false,
      missingParameters: false,
      missingIndices: [],
      retryCount: 0,
      pendingWrites: 0
    }
  })
  useVehicleStore.setState({
    vehicles: {},
    activeVehicleId: 1,
    ipcLatency: 0,
    mergeCount: 0
  })
})

describe('OutputConfigSection — loading states', () => {
  it('shows "Waiting for parameters..." when not ready', () => {
    render(<OutputConfigSection />)
    expect(screen.getByText('Waiting for parameters...')).toBeTruthy()
  })

  it('shows "No SERVO parameters found" when ready but no servo params', () => {
    useParameterStore.setState({
      parameters: new Map(),
      loadState: {
        totalCount: 0,
        receivedCount: 0,
        loadProgress: 1,
        parametersReady: true,
        missingParameters: false,
        missingIndices: [],
        retryCount: 0,
        pendingWrites: 0
      }
    })
    render(<OutputConfigSection />)
    expect(screen.getByText('No SERVO parameters found')).toBeTruthy()
  })
})

describe('OutputConfigSection — table rendering', () => {
  it('renders correct number of servo channel rows', () => {
    setupServoParams(8)
    render(<OutputConfigSection />)
    // Should show SERVO 1 through SERVO 8
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`SERVO ${i}`)).toBeTruthy()
    }
  })

  it('renders column headers', () => {
    setupServoParams(4)
    render(<OutputConfigSection />)
    expect(screen.getByText('Channel')).toBeTruthy()
    expect(screen.getByText('Function')).toBeTruthy()
    expect(screen.getByText('Min')).toBeTruthy()
    expect(screen.getByText('Max')).toBeTruthy()
    expect(screen.getByText('Trim')).toBeTruthy()
    expect(screen.getByText('Rev')).toBeTruthy()
  })

  it('detects servo count by checking consecutive SERVOx_FUNCTION params', () => {
    // Create params for channels 1-3 only (gap at 4)
    const params = new Map<string, Parameter>()
    for (let i = 1; i <= 3; i++) {
      params.set(`SERVO${i}_FUNCTION`, makeParam(`SERVO${i}_FUNCTION`, 0))
      params.set(`SERVO${i}_MIN`, makeParam(`SERVO${i}_MIN`, 1000))
      params.set(`SERVO${i}_MAX`, makeParam(`SERVO${i}_MAX`, 2000))
      params.set(`SERVO${i}_TRIM`, makeParam(`SERVO${i}_TRIM`, 1500))
      params.set(`SERVO${i}_REVERSED`, makeParam(`SERVO${i}_REVERSED`, 0))
    }
    useParameterStore.setState({
      parameters: params,
      loadState: {
        totalCount: 15,
        receivedCount: 15,
        loadProgress: 1,
        parametersReady: true,
        missingParameters: false,
        missingIndices: [],
        retryCount: 0,
        pendingWrites: 0
      }
    })
    render(<OutputConfigSection />)
    expect(screen.getByText('SERVO 1')).toBeTruthy()
    expect(screen.getByText('SERVO 2')).toBeTruthy()
    expect(screen.getByText('SERVO 3')).toBeTruthy()
    expect(screen.queryByText('SERVO 4')).toBeNull()
  })

  it('renders function dropdown with current value selected', () => {
    setupServoParams(1) // SERVO1_FUNCTION = 33 (Motor1)
    const { container } = render(<OutputConfigSection />)
    const selects = container.querySelectorAll('select')
    expect(selects.length).toBe(1)
    expect(selects[0]!.value).toBe('33')
  })

  it('renders min/max/trim number inputs with correct values', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const inputs = container.querySelectorAll('input[type="number"]')
    expect(inputs.length).toBe(3) // min, max, trim
    expect((inputs[0] as HTMLInputElement).value).toBe('1000')
    expect((inputs[1] as HTMLInputElement).value).toBe('2000')
    expect((inputs[2] as HTMLInputElement).value).toBe('1500')
  })

  it('renders reversed checkbox unchecked when REVERSED=0', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).toBeTruthy()
    expect(checkbox.checked).toBe(false)
  })
})

describe('OutputConfigSection — editing and save/discard', () => {
  it('does not show Save/Discard buttons initially', () => {
    setupServoParams(4)
    render(<OutputConfigSection />)
    expect(screen.queryByText('Save')).toBeNull()
    expect(screen.queryByText('Discard')).toBeNull()
  })

  it('shows Save/Discard buttons after editing a value', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const minInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '1100' } })
    expect(screen.getByText('Save')).toBeTruthy()
    expect(screen.getByText('Discard')).toBeTruthy()
  })

  it('hides Save/Discard after clicking Discard', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const minInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '1100' } })
    expect(screen.getByText('Save')).toBeTruthy()

    fireEvent.click(screen.getByText('Discard'))
    expect(screen.queryByText('Save')).toBeNull()
    expect(screen.queryByText('Discard')).toBeNull()
  })

  it('restores original value after Discard', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const minInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '1100' } })
    expect(minInput.value).toBe('1100')

    fireEvent.click(screen.getByText('Discard'))
    // Value should revert to the store value
    const minInputAfter = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    expect(minInputAfter.value).toBe('1000')
  })

  it('calls bridge.setParameter on Save', async () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const minInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '1100' } })

    fireEvent.click(screen.getByText('Save'))
    // Wait for async save
    await vi.waitFor(() => {
      expect(mockSetParameter).toHaveBeenCalledWith(1, 'SERVO1_MIN', 1100)
    })
  })

  it('editing function dropdown tracks change', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const select = container.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '0' } }) // Change to Disabled
    expect(screen.getByText('Save')).toBeTruthy()
  })

  it('toggling reversed checkbox tracks change', () => {
    setupServoParams(1)
    const { container } = render(<OutputConfigSection />)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(screen.getByText('Save')).toBeTruthy()
  })
})
