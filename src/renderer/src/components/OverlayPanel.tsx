import { useCallback } from 'react'
import { useOverlayStore } from '../store/overlayStore'
import type { KmlImportResult } from '../../../shared-types/ipc/OverlayTypes'
import styles from './OverlayPanel.module.css'

export function OverlayPanel(): React.JSX.Element | null {
  const layers = useOverlayStore((s) => s.layers)
  const addLayer = useOverlayStore((s) => s.addLayer)
  const toggleVisibility = useOverlayStore((s) => s.toggleVisibility)
  const removeLayer = useOverlayStore((s) => s.removeLayer)
  const clearLayers = useOverlayStore((s) => s.clearLayers)
  const focusLayer = useOverlayStore((s) => s.focusLayer)

  const handleImport = useCallback(async () => {
    const result = await window.bridge?.kmlImport()
    if (!result || 'cancelled' in result) return
    const kml = result as KmlImportResult
    addLayer(kml.fileName, kml.geometries)
  }, [addLayer])

  if (layers.length === 0) return null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Overlays</span>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={() => void handleImport()}
            title="Import KML overlay"
          >
            +
          </button>
          <button className={styles.clearBtn} onClick={clearLayers} title="Remove all overlays">
            Clear
          </button>
        </div>
      </div>
      <div className={styles.list}>
        {layers.map((layer) => {
          const color = layer.geometries[0]?.color ?? '#888888'
          return (
            <div key={layer.id} className={styles.item}>
              <div className={styles.colorSwatch} style={{ backgroundColor: color }} />
              <span
                className={`${styles.layerName} ${!layer.visible ? styles.dimmed : ''}`}
                onClick={() => focusLayer(layer.id)}
                role="button"
              >
                {layer.name || 'Unnamed'}
              </span>
              <button
                className={styles.iconBtn}
                onClick={() => toggleVisibility(layer.id)}
                title={layer.visible ? 'Hide' : 'Show'}
              >
                {layer.visible ? '\u25C9' : '\u25CE'}
              </button>
              <button
                className={styles.iconBtn}
                onClick={() => removeLayer(layer.id)}
                title="Remove overlay"
              >
                {'\u2715'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
