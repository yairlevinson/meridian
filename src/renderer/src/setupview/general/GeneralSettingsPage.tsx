import { useCallback } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { providers, getProviderNames } from '../../map/providers/ProviderRegistry'
import styles from './GeneralSettingsPage.module.css'

export function GeneralSettingsPage(): React.JSX.Element {
  const mapProvider = useSettingsStore((s) => s.settings.mapProvider)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const onProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSetting('mapProvider', e.target.value)
    },
    [setSetting]
  )

  return (
    <div className={styles.root}>
      <div className={styles.title}>General</div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Map</div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="map-provider">
            Tile Provider
          </label>
          <select
            id="map-provider"
            className={styles.select}
            value={mapProvider}
            onChange={onProviderChange}
          >
            {getProviderNames().map((name) => (
              <option key={name} value={name}>
                {providers[name]!.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
