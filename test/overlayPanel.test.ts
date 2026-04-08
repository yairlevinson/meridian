// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { useOverlayStore } from '../src/renderer/src/store/overlayStore'
import { OverlayPanel } from '../src/renderer/src/components/OverlayPanel'
import type { KmlGeometry } from '../src/shared-types/ipc/OverlayTypes'

const makeGeometry = (color = '#ff0000'): KmlGeometry => ({
  name: 'Zone',
  type: 'polygon',
  vertices: [
    { lat: 30.9, lon: 34.8 },
    { lat: 30.9, lon: 34.9 },
    { lat: 31.0, lon: 34.9 },
    { lat: 30.9, lon: 34.8 }
  ],
  color,
  lineWidth: 3
})

describe('OverlayPanel', () => {
  beforeEach(() => {
    useOverlayStore.setState({ layers: [], focusLayerId: null })
    localStorage.clear()
  })

  it('renders nothing when no layers exist', () => {
    const { container } = render(createElement(OverlayPanel))
    expect(container.innerHTML).toBe('')
  })

  it('renders overlay entries when layers exist', () => {
    useOverlayStore.getState().addLayer('Test Overlay', [makeGeometry()])

    render(createElement(OverlayPanel))
    expect(screen.getByText('Test Overlay')).toBeTruthy()
  })

  it('clicking layer name sets focusLayerId', () => {
    useOverlayStore.getState().addLayer('Clickable Layer', [makeGeometry()])
    const id = useOverlayStore.getState().layers[0]!.id

    render(createElement(OverlayPanel))
    fireEvent.click(screen.getByText('Clickable Layer'))

    expect(useOverlayStore.getState().focusLayerId).toBe(id)
  })

  it('clicking visibility toggle hides the layer', () => {
    useOverlayStore.getState().addLayer('Toggled', [makeGeometry()])

    render(createElement(OverlayPanel))
    const toggleBtn = screen.getByTitle('Hide')
    fireEvent.click(toggleBtn)

    expect(useOverlayStore.getState().layers[0]!.visible).toBe(false)
  })

  it('clicking delete removes the layer', () => {
    useOverlayStore.getState().addLayer('Deletable', [makeGeometry()])

    render(createElement(OverlayPanel))
    fireEvent.click(screen.getByTitle('Remove overlay'))

    expect(useOverlayStore.getState().layers).toHaveLength(0)
  })

  it('clicking Clear removes all layers', () => {
    useOverlayStore.getState().addLayer('A', [makeGeometry()])
    useOverlayStore.getState().addLayer('B', [makeGeometry()])

    render(createElement(OverlayPanel))
    fireEvent.click(screen.getByTitle('Remove all overlays'))

    expect(useOverlayStore.getState().layers).toHaveLength(0)
  })
})
