import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { useVehicleStore } from '../../store/vehicleStore'
import { ParameterLoading } from '../ParameterLoading'
import {
  PX4_AIRFRAME_GROUPS,
  ARDU_FRAME_CLASSES,
  ARDU_FRAME_TYPES,
  findGroupByAutostartId,
  type AirframeGroup,
  type ArduFrameClass
} from './airframeData'
import styles from './AirframePage.module.css'

const MAV_AUTOPILOT_PX4 = 12

/* ── SVG imports ──────────────────────────── */

const svgModules = import.meta.glob('./images/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

function getSvgUrl(imageName: string): string | undefined {
  const key = `./images/${imageName}.svg`
  return svgModules[key]
}

/* ── PX4 Airframe Page ────────────────────── */

function PX4AirframePage({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const savedAutostart = parameters.get('SYS_AUTOSTART')?.value ?? 0

  const [selectedGroup, setSelectedGroup] = useState<AirframeGroup | null>(null)
  const [selectedId, setSelectedId] = useState(savedAutostart)
  const [confirming, setConfirming] = useState(false)

  const currentGroup = useMemo(() => findGroupByAutostartId(savedAutostart), [savedAutostart])

  useEffect(() => {
    setSelectedId(savedAutostart)
    setSelectedGroup(null)
    setConfirming(false)
  }, [savedAutostart])

  const handleApply = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge || selectedId === savedAutostart) return
    setConfirming(true)
    await bridge.setParameter(vehicleId, 'SYS_AUTOSTART', selectedId)
    setConfirming(false)
  }, [vehicleId, selectedId, savedAutostart])

  const hasChanges = selectedId !== savedAutostart

  // Expanded group view — show airframe variants
  if (selectedGroup) {
    const svgUrl = getSvgUrl(selectedGroup.image)
    return (
      <div className={styles.root}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => setSelectedGroup(null)}>
            &larr; Back
          </button>
          <div className={styles.title}>{selectedGroup.name}</div>
        </div>

        <div className={styles.detailLayout}>
          <div className={styles.detailImage}>
            {svgUrl && <img src={svgUrl} alt={selectedGroup.name} className={styles.detailSvg} />}
          </div>
          <div className={styles.variantList}>
            {selectedGroup.airframes.map((af) => (
              <button
                key={af.id}
                className={`${styles.variantItem} ${af.id === selectedId ? styles.variantSelected : ''} ${af.id === savedAutostart ? styles.variantCurrent : ''}`}
                onClick={() => setSelectedId(af.id)}
              >
                <span className={styles.variantName}>{af.name}</span>
                <span className={styles.variantId}>{af.id}</span>
                {af.id === savedAutostart && <span className={styles.currentBadge}>current</span>}
              </button>
            ))}
          </div>
        </div>

        {hasChanges && (
          <div className={styles.toolbar}>
            <button className={styles.saveBtn} onClick={handleApply} disabled={confirming}>
              {confirming ? 'Applying...' : 'Apply & Restart'}
            </button>
            <button className={styles.cancelBtn} onClick={() => setSelectedId(savedAutostart)}>
              Discard
            </button>
          </div>
        )}
      </div>
    )
  }

  // Grid view — show all groups
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Airframe</div>
        <div className={styles.subtitle}>
          {currentGroup
            ? `Current: ${currentGroup.name} (${savedAutostart})`
            : savedAutostart > 0
              ? `SYS_AUTOSTART: ${savedAutostart}`
              : 'No airframe configured'}
        </div>
      </div>

      <div className={styles.grid}>
        {PX4_AIRFRAME_GROUPS.map((group) => {
          const svgUrl = getSvgUrl(group.image)
          const isCurrent = group === currentGroup
          return (
            <button
              key={group.name}
              className={`${styles.card} ${isCurrent ? styles.cardCurrent : ''}`}
              onClick={() => setSelectedGroup(group)}
            >
              <div className={styles.cardImage}>
                {svgUrl ? (
                  <img src={svgUrl} alt={group.name} className={styles.cardSvg} />
                ) : (
                  <div className={styles.cardPlaceholder}>?</div>
                )}
              </div>
              <div className={styles.cardLabel}>{group.name}</div>
              {isCurrent && <div className={styles.cardBadge}>Active</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── ArduPilot Airframe Page ──────────────── */

function ArduPilotAirframePage({ vehicleId }: { vehicleId: number }): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const savedFrameClass = parameters.get('FRAME_CLASS')?.value ?? 0
  const savedFrameType = parameters.get('FRAME_TYPE')?.value ?? 0

  const [frameClass, setFrameClass] = useState(savedFrameClass)
  const [frameType, setFrameType] = useState(savedFrameType)

  useEffect(() => {
    setFrameClass(savedFrameClass)
    setFrameType(savedFrameType)
  }, [savedFrameClass, savedFrameType])

  const hasChanges = frameClass !== savedFrameClass || frameType !== savedFrameType

  const handleSave = useCallback(async () => {
    const bridge = window.bridge
    if (!bridge) return
    await bridge.setParameter(vehicleId, 'FRAME_CLASS', frameClass)
    await bridge.setParameter(vehicleId, 'FRAME_TYPE', frameType)
  }, [vehicleId, frameClass, frameType])

  const currentClassDef = ARDU_FRAME_CLASSES.find((c) => c.value === frameClass)
  const svgUrl = currentClassDef ? getSvgUrl(currentClassDef.image) : undefined

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Airframe</div>
        <div className={styles.subtitle}>ArduPilot Frame Configuration</div>
      </div>

      <div className={styles.arduLayout}>
        {/* Frame class cards */}
        <div className={styles.classSection}>
          <div className={styles.sectionLabel}>Frame Class</div>
          <div className={styles.classGrid}>
            {ARDU_FRAME_CLASSES.map((fc) => {
              const url = getSvgUrl(fc.image)
              const isSelected = fc.value === frameClass
              return (
                <button
                  key={fc.value}
                  className={`${styles.classCard} ${isSelected ? styles.classCardSelected : ''}`}
                  onClick={() => setFrameClass(fc.value)}
                >
                  <div className={styles.classCardImage}>
                    {url ? (
                      <img src={url} alt={fc.name} className={styles.cardSvg} />
                    ) : (
                      <div className={styles.cardPlaceholder}>?</div>
                    )}
                  </div>
                  <div className={styles.classCardLabel}>{fc.name}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Frame type + preview */}
        <div className={styles.typeSection}>
          <div className={styles.previewArea}>
            {svgUrl && (
              <img src={svgUrl} alt={currentClassDef?.name} className={styles.previewSvg} />
            )}
          </div>
          <div className={styles.sectionLabel}>Frame Type</div>
          <div className={styles.typeGrid}>
            {ARDU_FRAME_TYPES.map((ft) => (
              <button
                key={ft.value}
                className={`${styles.typeBtn} ${ft.value === frameType ? styles.typeBtnSelected : ''}`}
                onClick={() => setFrameType(ft.value)}
              >
                {ft.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasChanges && (
        <div className={styles.toolbar}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
          <button
            className={styles.cancelBtn}
            onClick={() => {
              setFrameClass(savedFrameClass)
              setFrameType(savedFrameType)
            }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Main entry — detect autopilot type ──── */

export function AirframePage(): React.JSX.Element {
  const loadState = useParameterStore((s) => s.loadState)
  const vehicleId = useVehicleStore((s) => s.activeVehicleId) ?? 1
  const vehicles = useVehicleStore((s) => s.vehicles)
  const autopilot = vehicleId ? vehicles[vehicleId]?.core?.autopilot : undefined
  const isPX4 = autopilot === MAV_AUTOPILOT_PX4

  if (!loadState.parametersReady) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Airframe</div>
        <ParameterLoading />
      </div>
    )
  }

  return isPX4 ? (
    <PX4AirframePage vehicleId={vehicleId} />
  ) : (
    <ArduPilotAirframePage vehicleId={vehicleId} />
  )
}
