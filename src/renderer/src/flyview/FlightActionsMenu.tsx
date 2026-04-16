import { useState, useCallback } from 'react'
import { useCommand } from '../hooks/useCommand'
import { useTelemetry } from '../hooks/useVehicle'
import { rlog } from '../lib/rlog'
import styles from './FlightActionsMenu.module.css'

const log = rlog('FlightActions')

type OrbitDir = 'cw' | 'ccw'
type SpeedType = 'air' | 'ground'

type StatusKind = 'ok' | 'err' | 'pending' | null
type Status = { kind: StatusKind; msg: string }

const EMPTY_STATUS: Status = { kind: null, msg: '' }

export function FlightActionsMenu(): React.JSX.Element {
  const {
    guidedChangeAltitude,
    guidedChangeHeading,
    guidedChangeSpeed,
    guidedOrbit,
    landingGearDeploy,
    landingGearRetract
  } = useCommand()

  const gps = useTelemetry('gps')
  const vfr = useTelemetry('vfrHud')

  const currentAlt = gps?.relativeAlt ?? 0
  const currentHdg = Math.round(gps?.hdg ?? 0)
  const currentGs = vfr?.groundspeed ?? 0

  const [alt, setAlt] = useState<string>('')
  const [hdg, setHdg] = useState<string>('')
  const [speed, setSpeed] = useState<string>('')
  const [speedType, setSpeedType] = useState<SpeedType>('ground')
  const [orbitRadius, setOrbitRadius] = useState<string>('50')
  const [orbitAlt, setOrbitAlt] = useState<string>('')
  const [orbitDir, setOrbitDir] = useState<OrbitDir>('cw')
  const [status, setStatus] = useState<Status>(EMPTY_STATUS)

  const run = useCallback(
    async (label: string, fn: () => Promise<number | undefined> | undefined): Promise<void> => {
      log.debug('%s: sending', label)
      setStatus({ kind: 'pending', msg: `${label}…` })
      try {
        const result = await fn()
        log.debug('%s: result=%s', label, String(result))
        if (result === undefined || result === 0) {
          setStatus({ kind: 'ok', msg: `${label} accepted` })
        } else {
          setStatus({ kind: 'err', msg: `${label} rejected (${result})` })
        }
      } catch (e) {
        log.error('%s: threw %o', label, e)
        setStatus({ kind: 'err', msg: `${label} failed: ${e instanceof Error ? e.message : e}` })
      }
    },
    []
  )

  const applyAlt = (): Promise<void> => {
    const v = parseFloat(alt)
    if (!Number.isFinite(v)) {
      setStatus({ kind: 'err', msg: 'Invalid altitude' })
      return Promise.resolve()
    }
    return run('Altitude', () => guidedChangeAltitude(v))
  }

  const applyHeading = (value?: number): Promise<void> => {
    const v = value ?? parseFloat(hdg)
    if (!Number.isFinite(v)) {
      setStatus({ kind: 'err', msg: 'Invalid heading' })
      return Promise.resolve()
    }
    return run('Heading', () => guidedChangeHeading(v))
  }

  const applySpeed = (): Promise<void> => {
    const v = parseFloat(speed)
    if (!Number.isFinite(v) || v <= 0) {
      setStatus({ kind: 'err', msg: 'Invalid speed' })
      return Promise.resolve()
    }
    const type: 0 | 1 = speedType === 'air' ? 0 : 1
    return run('Speed', () => guidedChangeSpeed(v, type))
  }

  const applyOrbit = (): Promise<void> => {
    const r = parseFloat(orbitRadius)
    const a = orbitAlt === '' ? currentAlt : parseFloat(orbitAlt)
    if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(a)) {
      setStatus({ kind: 'err', msg: 'Invalid orbit' })
      return Promise.resolve()
    }
    if (!gps || gps.lat === 0) {
      setStatus({ kind: 'err', msg: 'No GPS fix' })
      return Promise.resolve()
    }
    const signed = orbitDir === 'ccw' ? -r : r
    return run('Orbit', () => guidedOrbit(gps.lat, gps.lon, signed, a))
  }

  const doGearDeploy = (): Promise<void> => run('Gear deploy', () => landingGearDeploy())
  const doGearRetract = (): Promise<void> => run('Gear retract', () => landingGearRetract())

  return (
    <div className={styles.menu}>
      <div className={styles.sectionTitle}>Altitude</div>
      <div className={styles.row}>
        <span className={styles.label}>Target</span>
        <input
          className={styles.input}
          type="number"
          placeholder={currentAlt.toFixed(1)}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyAlt()}
        />
        <span className={styles.unit}>m</span>
        <button className={styles.applyBtn} onClick={applyAlt} disabled={alt === ''}>
          Set
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionTitle}>Heading</div>
      <div className={styles.row}>
        <span className={styles.label}>Target</span>
        <input
          className={styles.input}
          type="number"
          placeholder={String(currentHdg)}
          value={hdg}
          onChange={(e) => setHdg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyHeading()}
        />
        <span className={styles.unit}>°</span>
        <button className={styles.applyBtn} onClick={() => applyHeading()} disabled={hdg === ''}>
          Set
        </button>
      </div>
      <div className={styles.compassRow}>
        <button className={styles.compassBtn} onClick={() => applyHeading(0)}>
          N
        </button>
        <button className={styles.compassBtn} onClick={() => applyHeading(90)}>
          E
        </button>
        <button className={styles.compassBtn} onClick={() => applyHeading(180)}>
          S
        </button>
        <button className={styles.compassBtn} onClick={() => applyHeading(270)}>
          W
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionTitle}>Speed</div>
      <div className={styles.segGroup}>
        <button
          className={`${styles.segBtn} ${speedType === 'ground' ? styles.segBtnActive : ''}`}
          onClick={() => setSpeedType('ground')}
        >
          Ground
        </button>
        <button
          className={`${styles.segBtn} ${speedType === 'air' ? styles.segBtnActive : ''}`}
          onClick={() => setSpeedType('air')}
        >
          Air
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Target</span>
        <input
          className={styles.input}
          type="number"
          placeholder={currentGs.toFixed(1)}
          value={speed}
          onChange={(e) => setSpeed(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySpeed()}
        />
        <span className={styles.unit}>m/s</span>
        <button className={styles.applyBtn} onClick={applySpeed} disabled={speed === ''}>
          Set
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionTitle}>Orbit (here)</div>
      <div className={styles.row}>
        <span className={styles.label}>Radius</span>
        <input
          className={styles.input}
          type="number"
          value={orbitRadius}
          onChange={(e) => setOrbitRadius(e.target.value)}
        />
        <span className={styles.unit}>m</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Alt</span>
        <input
          className={styles.input}
          type="number"
          placeholder={currentAlt.toFixed(1)}
          value={orbitAlt}
          onChange={(e) => setOrbitAlt(e.target.value)}
        />
        <span className={styles.unit}>m</span>
      </div>
      <div className={styles.segGroup}>
        <button
          className={`${styles.segBtn} ${orbitDir === 'cw' ? styles.segBtnActive : ''}`}
          onClick={() => setOrbitDir('cw')}
        >
          CW
        </button>
        <button
          className={`${styles.segBtn} ${orbitDir === 'ccw' ? styles.segBtnActive : ''}`}
          onClick={() => setOrbitDir('ccw')}
        >
          CCW
        </button>
      </div>
      <button className={styles.applyBtn} onClick={applyOrbit}>
        Start Orbit
      </button>

      <div className={styles.divider} />

      <div className={styles.sectionTitle}>Landing Gear</div>
      <div className={styles.gearRow}>
        <button className={styles.gearBtn} onClick={doGearDeploy}>
          Deploy
        </button>
        <button className={styles.gearBtn} onClick={doGearRetract}>
          Retract
        </button>
      </div>

      {status.kind && (
        <div
          className={`${styles.status} ${
            status.kind === 'err' ? styles.statusError : status.kind === 'ok' ? styles.statusOk : ''
          }`}
        >
          {status.msg}
        </div>
      )}
    </div>
  )
}
