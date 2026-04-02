// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useParameterStore } from '../src/renderer/src/store/parameterStore'
import { MotorSpinDirection } from '../src/renderer/src/setupview/actuators/MotorSpinDirection'
import { ParamValueType } from '../src/shared-types/ipc/ParameterTypes'
import type { Parameter } from '../src/shared-types/ipc/ParameterTypes'

function makeParam(name: string, value: number): Parameter {
  return { name, value, type: ParamValueType.REAL32, index: 0, componentId: 1 }
}

function setFrameParams(frameClass: number, frameType: number): void {
  const params = new Map<string, Parameter>()
  params.set('FRAME_CLASS', makeParam('FRAME_CLASS', frameClass))
  params.set('FRAME_TYPE', makeParam('FRAME_TYPE', frameType))
  useParameterStore.setState({
    parameters: params,
    loadState: {
      totalCount: 2,
      receivedCount: 2,
      loadProgress: 1,
      parametersReady: true,
      missingParameters: false,
      missingIndices: [],
      retryCount: 0,
      pendingWrites: 0
    }
  })
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
  })

  it('shows loading state when parameters are not ready', () => {
    render(<MotorSpinDirection />)
    expect(screen.getByText('Waiting for parameters...')).toBeTruthy()
  })

  it('shows "no diagram" for unknown frame class', () => {
    setFrameParams(0, 0) // frameClass 0 has no layout
    render(<MotorSpinDirection />)
    expect(screen.getByText(/No diagram available for frame class 0/)).toBeTruthy()
  })

  it('renders SVG diagram for Quad X (frameClass=1, frameType=1)', () => {
    setFrameParams(1, 1)
    const { container } = render(<MotorSpinDirection />)
    // Should have an SVG with motor circles
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    // Quad X has 4 motors — 4 motor circles + 1 center body
    const circles = svg!.querySelectorAll('circle')
    expect(circles.length).toBe(5) // 4 motors + 1 center
  })

  it('renders frame label for Quad X', () => {
    setFrameParams(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('Quad X')).toBeTruthy()
  })

  it('renders frame label for Hexa Plus', () => {
    setFrameParams(2, 0)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/Hexa/)).toBeTruthy()
    expect(screen.getByText(/Plus/)).toBeTruthy()
  })

  it('renders 6 motor circles for Hexa X', () => {
    setFrameParams(2, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    // 6 motors + 1 center body
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBe(7)
  })

  it('renders 8 motor circles for Octa X', () => {
    setFrameParams(3, 1)
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBe(9) // 8 motors + 1 center
  })

  it('renders motor number labels in SVG', () => {
    setFrameParams(1, 1) // Quad X
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
    setFrameParams(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('CW')).toBeTruthy()
    expect(screen.getByText('CCW')).toBeTruthy()
  })

  it('renders FRONT indicator', () => {
    setFrameParams(1, 1)
    render(<MotorSpinDirection />)
    expect(screen.getByText('FRONT')).toBeTruthy()
  })

  it('renders CW/CCW arc paths for each motor', () => {
    setFrameParams(1, 1) // Quad X: 2 CW + 2 CCW
    const { container } = render(<MotorSpinDirection />)
    const svg = container.querySelector('svg')!
    // Each motor gets an arc path inside its <g> group
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBe(4) // one arc per motor
  })

  it('shows "no diagram" message for Heli frame (class 6)', () => {
    setFrameParams(6, 0)
    render(<MotorSpinDirection />)
    expect(screen.getByText(/No diagram available for frame class 6/)).toBeTruthy()
  })
})

describe('MotorSpinDirection — highlightMotor prop', () => {
  beforeEach(() => {
    setFrameParams(1, 1) // Quad X
  })

  it('highlights the specified motor with orange fill', () => {
    const { container } = render(<MotorSpinDirection highlightMotor={1} />)
    const svg = container.querySelector('svg')!
    const circles = svg.querySelectorAll('circle')
    // Motor circles are after the center circle, find one with orange fill
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
    // Filter out center circle and highlighted motor
    const motorCircles = circles.filter(
      (c) =>
        c.getAttribute('fill') !== 'var(--bg-elevated)' &&
        c.getAttribute('fill') !== '#ffab40'
    )
    // Remaining 3 motors should have CW (accent-blue) or CCW (#4ec3e8) colors
    for (const mc of motorCircles) {
      const fill = mc.getAttribute('fill')
      expect(fill === 'var(--accent-blue)' || fill === '#4ec3e8').toBe(true)
    }
  })
})
