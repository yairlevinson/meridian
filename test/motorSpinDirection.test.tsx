// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useParameterStore } from '../src/renderer/src/store/parameterStore'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import { MotorSpinDirection } from '../src/renderer/src/setupview/actuators/MotorSpinDirection'
import { ParamValueType } from '../src/shared-types/ipc/ParameterTypes'
import type { Parameter } from '../src/shared-types/ipc/ParameterTypes'

function makeParam(name: string, value: number): Parameter {
  return { name, value, type: ParamValueType.REAL32, index: 0, componentId: 1 }
}

const readyLoadState = {
  totalCount: 10,
  receivedCount: 10,
  loadProgress: 1,
  parametersReady: true,
  missingParameters: false,
  missingIndices: [] as number[],
  retryCount: 0,
  pendingWrites: 0
}

/** Set ArduPilot vehicle (autopilot=3) with FRAME_CLASS/FRAME_TYPE */
function setArduPilotFrame(frameClass: number, frameType: number): void {
  const params = new Map<string, Parameter>()
  params.set('FRAME_CLASS', makeParam('FRAME_CLASS', frameClass))
  params.set('FRAME_TYPE', makeParam('FRAME_TYPE', frameType))
  useParameterStore.setState({ parameters: params, loadState: readyLoadState })
  // Set autopilot=3 (ArduPilot) — or leave default (0 falls through to ArduPilot path)
  useVehicleStore.getState().mergeDelta(
    1,
    {
      core: {
        sysid: 1,
        compid: 1,
        armed: false,
        flightMode: 0,
        flightModeName: 'STABILIZE',
        vehicleType: 2,
        autopilot: 3,
        systemStatus: 3,
        firmwareVersionMajor: 4,
        firmwareVersionMinor: 0,
        firmwareVersionPatch: 3,
        communicationLost: false,
        communicationLostCountdown: 0,
        seq: 1
      }
    },
    Date.now()
  )
  useVehicleStore.setState({ activeVehicleId: 1 })
}

/** Set PX4 vehicle (autopilot=12) with SYS_AUTOSTART */
function setPx4Autostart(autostart: number): void {
  const params = new Map<string, Parameter>()
  params.set('SYS_AUTOSTART', makeParam('SYS_AUTOSTART', autostart))
  useParameterStore.setState({ parameters: params, loadState: readyLoadState })
  useVehicleStore.getState().mergeDelta(
    1,
    {
      core: {
        sysid: 1,
        compid: 1,
        armed: false,
        flightMode: 0,
        flightModeName: 'MANUAL',
        vehicleType: 2,
        autopilot: 12,
        systemStatus: 3,
        firmwareVersionMajor: 1,
        firmwareVersionMinor: 15,
        firmwareVersionPatch: 0,
        communicationLost: false,
        communicationLostCountdown: 0,
        seq: 1
      }
    },
    Date.now()
  )
  useVehicleStore.setState({ activeVehicleId: 1 })
}

describe('MotorSpinDirection — rendering states', () => {
  beforeEach(() => {
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
      activeVehicleId: null,
      ipcLatency: 0,
      mergeCount: 0
    })
  })

  it('shows loading state when parameters are not ready', () => {
    render(<MotorSpinDirection />)
    expect(screen.getByText('Waiting for parameters...')).toBeTruthy()
  })

  it('shows "no diagram" for unknown frame class', () => {
    setArduPilotFrame(0, 0)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/No diagram available/)).toBeTruthy()
  })

  it('renders SVG diagram for Quad X (frameClass=1, frameType=1)', () => {
    setArduPilotFrame(1, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const circles = svg!.querySelectorAll('circle')
    expect(circles.length).toBe(5) // 4 motors + 1 center
  })

  it('renders frame label for Quad X', () => {
    setArduPilotFrame(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('Quad X')).toBeTruthy()
  })

  it('renders frame label for Hexa Plus', () => {
    setArduPilotFrame(2, 0)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/Hexa/)).toBeTruthy()
    expect(screen.getByText(/Plus/)).toBeTruthy()
  })

  it('renders 6 motor circles for Hexa X', () => {
    setArduPilotFrame(2, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBe(7)
  })

  it('renders 8 motor circles for Octa X', () => {
    setArduPilotFrame(3, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBe(9) // 8 motors + 1 center
  })

  it('renders motor number labels in SVG', () => {
    setArduPilotFrame(1, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const textElements = svg.querySelectorAll('text')
    const labels = Array.from(textElements).map((t) => t.textContent)
    expect(labels).toContain('1')
    expect(labels).toContain('2')
    expect(labels).toContain('3')
    expect(labels).toContain('4')
  })

  it('renders CW and CCW legend', () => {
    setArduPilotFrame(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('CW')).toBeTruthy()
    expect(screen.getByText('CCW')).toBeTruthy()
  })

  it('renders FRONT indicator', () => {
    setArduPilotFrame(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('FRONT')).toBeTruthy()
  })

  it('renders CW/CCW arc paths for each motor', () => {
    setArduPilotFrame(1, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBe(4) // one arc per motor
  })

  it('shows "no diagram" message for Heli frame (class 6)', () => {
    setArduPilotFrame(6, 0)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/No diagram available/)).toBeTruthy()
  })
})

describe('MotorSpinDirection — highlightMotor prop', () => {
  beforeEach(() => {
    setArduPilotFrame(1, 1) // Quad X
  })

  it('highlights the specified motor with orange fill', () => {
    const { container } = render(<MotorSpinDirection highlightMotor={1} />)
    const svg = container.querySelector('svg')!
    const circles = svg.querySelectorAll('circle')
    const orangeCircles = Array.from(circles).filter(
      (c) => c.getAttribute('fill') === '#ffab40'
    )
    expect(orangeCircles.length).toBe(1)
  })

  it('highlighted motor has white stroke', () => {
    const { container } = render(<MotorSpinDirection highlightMotor={2} />)
    const svg = container.querySelector('svg')!
    const circles = Array.from(svg.querySelectorAll('circle'))
    const highlighted = circles.find((c) => c.getAttribute('stroke') === '#fff')
    expect(highlighted).toBeTruthy()
  })

  it('non-highlighted motors retain CW/CCW colors', () => {
    const { container } = render(<MotorSpinDirection highlightMotor={1} />)
    const svg = container.querySelector('svg')!
    const circles = Array.from(svg.querySelectorAll('circle'))
    const motorCircles = circles.filter(
      (c) =>
        c.getAttribute('fill') !== 'var(--bg-elevated)' &&
        c.getAttribute('fill') !== '#ffab40'
    )
    for (const mc of motorCircles) {
      const fill = mc.getAttribute('fill')
      expect(fill === 'var(--accent-blue)' || fill === '#4ec3e8').toBe(true)
    }
  })
})

describe('MotorSpinDirection — PX4 support', () => {
  beforeEach(() => {
    useVehicleStore.setState({
      vehicles: {},
      activeVehicleId: null,
      ipcLatency: 0,
      mergeCount: 0
    })
  })

  it('renders Quad X for PX4 SYS_AUTOSTART=4001', () => {
    setPx4Autostart(4001)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const circles = svg!.querySelectorAll('circle')
    expect(circles.length).toBe(5) // 4 motors + 1 center
    expect(screen.getByText('Quad X')).toBeTruthy()
  })

  it('renders Quad + for PX4 SYS_AUTOSTART=4010', () => {
    setPx4Autostart(4010)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(screen.getByText('Quad +')).toBeTruthy()
  })

  it('renders Hexa X for PX4 SYS_AUTOSTART=6001', () => {
    setPx4Autostart(6001)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const circles = svg!.querySelectorAll('circle')
    expect(circles.length).toBe(7) // 6 motors + 1 center
    expect(screen.getByText('Hexa X')).toBeTruthy()
  })

  it('renders Hexa + for PX4 SYS_AUTOSTART=6002', () => {
    setPx4Autostart(6002)
    render(<MotorSpinDirection />)
    expect(screen.getByText('Hexa +')).toBeTruthy()
  })

  it('shows "no diagram" for unknown PX4 airframe', () => {
    setPx4Autostart(9999)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/No diagram available/)).toBeTruthy()
  })

  it('shows motor labels 1-4 for PX4 Quad X', () => {
    setPx4Autostart(4001)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)
    expect(labels).toContain('1')
    expect(labels).toContain('2')
    expect(labels).toContain('3')
    expect(labels).toContain('4')
  })
})
