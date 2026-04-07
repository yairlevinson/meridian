import { useEffect, useRef, useCallback } from 'react'
import { useRadarStore } from '../../store/radarStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { RadarState, RadarTrack, RadarUnit } from '../../../../shared-types/ipc/RadarTypes'
import styles from './RadarScope.module.css'

const DEG_TO_RAD = Math.PI / 180
const TWO_PI = Math.PI * 2
const METERS_PER_DEG_LAT = 111_111
const SWEEP_RPM = 15
const SWEEP_TRAIL_DEG = 30

const FRIENDLY_COLOR = '#4488ff'
const HOSTILE_COLOR = '#ff4444'
const SCOPE_GREEN = 'rgba(0, 255, 80,'

interface RadarScopeProps {
  size: number
}

/** Convert a track's geographic position to canvas-relative x/y */
function trackToCanvas(
  track: RadarTrack,
  unit: RadarUnit,
  radiusMeters: number,
  canvasRadius: number,
  centerX: number,
  centerY: number
): { x: number; y: number; dist: number } | null {
  const dx = (track.lon - unit.lon) * METERS_PER_DEG_LAT * Math.cos(unit.lat * DEG_TO_RAD)
  const dy = (track.lat - unit.lat) * METERS_PER_DEG_LAT
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist > radiusMeters) return null
  const scale = canvasRadius / radiusMeters
  return {
    x: centerX + dx * scale,
    y: centerY - dy * scale, // Y inverted
    dist
  }
}

/** Normalize angle to [0, 2PI) */
function normAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI
}

// Pre-generated noise points (stable between frames)
const NOISE_POINTS = Array.from({ length: 300 }, () => ({
  angle: Math.random() * TWO_PI,
  dist: Math.random(),
  size: 0.5 + Math.random() * 1.5
}))

export function RadarScope({ size }: RadarScopeProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const sweepRef = useRef(0)
  const prevTimeRef = useRef(0)
  const hoveredRef = useRef<number | null>(null)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)

  // Read state into refs so the rAF loop doesn't restart on every data push
  const radarStateRef = useRef<RadarState | null>(null)
  const radiusRef = useRef(useSettingsStore.getState().settings.radarRadiusMeters)
  const setHoveredTrack = useRadarStore((s) => s.setHoveredTrack)

  useEffect(() => {
    const unsubRadar = useRadarStore.subscribe((s) => {
      radarStateRef.current = s.state
    })
    radarStateRef.current = useRadarStore.getState().state
    const unsubSettings = useSettingsStore.subscribe((s) => {
      radiusRef.current = s.settings.radarRadiusMeters
    })
    return () => {
      unsubRadar()
      unsubSettings()
    }
  }, [])

  const radiusMeters = useSettingsStore((s) => s.settings.radarRadiusMeters)

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const canvasSize = size * dpr
  const canvasRadius = (canvasSize / 2) * 0.9
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2

  // ── Static layer (rings, compass) drawn to offscreen canvas ──
  const staticRef = useRef<OffscreenCanvas | null>(null)

  const drawStaticLayer = useCallback(() => {
    const oc = new OffscreenCanvas(canvasSize, canvasSize)
    const ctx = oc.getContext('2d')!
    const cx = centerX
    const cy = centerY
    const r = canvasRadius

    // Range rings
    ctx.setLineDash([4 * dpr, 8 * dpr])
    ctx.lineWidth = 1 * dpr
    for (let i = 1; i <= 4; i++) {
      const ringR = (r / 4) * i
      ctx.strokeStyle = `${SCOPE_GREEN} 0.15)`
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, TWO_PI)
      ctx.stroke()

      // Distance label
      const dist = (radiusMeters / 4) * i
      const label = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`
      ctx.setLineDash([])
      ctx.font = `${10 * dpr}px monospace`
      ctx.fillStyle = `${SCOPE_GREEN} 0.45)`
      ctx.textAlign = 'left'
      ctx.fillText(label, cx + ringR + 4 * dpr, cy - 4 * dpr)
      ctx.setLineDash([4 * dpr, 8 * dpr])
    }
    ctx.setLineDash([])

    // Compass rose lines
    ctx.strokeStyle = `${SCOPE_GREEN} 0.08)`
    ctx.lineWidth = 1 * dpr
    // N-S
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx, cy + r)
    ctx.stroke()
    // E-W
    ctx.beginPath()
    ctx.moveTo(cx - r, cy)
    ctx.lineTo(cx + r, cy)
    ctx.stroke()

    // Cardinal labels
    ctx.font = `bold ${12 * dpr}px monospace`
    ctx.fillStyle = `${SCOPE_GREEN} 0.5)`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', cx, cy - r - 10 * dpr)
    ctx.fillText('S', cx, cy + r + 12 * dpr)
    ctx.fillText('E', cx + r + 12 * dpr, cy)
    ctx.fillText('W', cx - r - 12 * dpr, cy)

    // Center crosshair
    const chSize = 6 * dpr
    ctx.strokeStyle = `${SCOPE_GREEN} 0.4)`
    ctx.lineWidth = 1 * dpr
    ctx.beginPath()
    ctx.moveTo(cx - chSize, cy)
    ctx.lineTo(cx + chSize, cy)
    ctx.moveTo(cx, cy - chSize)
    ctx.lineTo(cx, cy + chSize)
    ctx.stroke()

    staticRef.current = oc
  }, [canvasSize, centerX, centerY, canvasRadius, radiusMeters, dpr])

  useEffect(() => {
    drawStaticLayer()
  }, [drawStaticLayer])

  // ── Main render loop ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })!

    const render = (timestamp: number): void => {
      if (!prevTimeRef.current) prevTimeRef.current = timestamp
      const dt = (timestamp - prevTimeRef.current) / 1000
      prevTimeRef.current = timestamp

      // Advance sweep angle
      sweepRef.current = normAngle(sweepRef.current + TWO_PI * (SWEEP_RPM / 60) * dt)
      const sweep = sweepRef.current

      const cx = centerX
      const cy = centerY
      const r = canvasRadius

      // 1. Background
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1)
      bgGrad.addColorStop(0, '#0a1a0a')
      bgGrad.addColorStop(0.7, '#060e06')
      bgGrad.addColorStop(1, '#000000')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, canvasSize, canvasSize)

      // 2. Clip to circle
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TWO_PI)
      ctx.clip()

      // 3. Static layer (rings, compass)
      if (staticRef.current) {
        ctx.drawImage(staticRef.current, 0, 0)
      }

      // 4. Range ring pulse (subtle)
      const pulseAlpha = 0.03 + Math.sin(timestamp * 0.002) * 0.015
      ctx.strokeStyle = `${SCOPE_GREEN} ${pulseAlpha})`
      ctx.lineWidth = 2 * dpr
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TWO_PI)
      ctx.stroke()

      // 5. Sweep beam
      drawSweepBeam(ctx, cx, cy, r, sweep)

      // 6. Scan noise
      drawNoise(ctx, cx, cy, r, timestamp)

      // 7. Tracks
      const currentState = radarStateRef.current
      const unit = currentState?.units[0]
      const tracks = currentState?.tracks ?? []
      let newHovered: number | null = null

      if (unit) {
        for (const track of tracks) {
          const pos = trackToCanvas(track, unit, radiusRef.current, r, cx, cy)
          if (!pos) continue

          // Afterglow: brightness based on sweep angle distance
          const trackAngle = normAngle(Math.atan2(pos.x - cx, -(pos.y - cy)))
          const angleDiff = normAngle(sweep - trackAngle)
          const brightness = Math.max(0.35, 1.0 - angleDiff / TWO_PI)

          drawTrack(ctx, pos.x, pos.y, track, brightness, dpr)

          // Velocity vector
          drawVelocityVector(ctx, pos.x, pos.y, track, brightness, dpr)

          // Hit-test for hover
          if (mouseRef.current) {
            const mx = mouseRef.current.x * dpr
            const my = mouseRef.current.y * dpr
            const dx = pos.x - mx
            const dy = pos.y - my
            if (dx * dx + dy * dy < (15 * dpr) ** 2) {
              newHovered = track.id
            }
          }
        }

        // Tooltip for hovered track
        if (newHovered !== null) {
          const hTrack = tracks.find((t) => t.id === newHovered)
          if (hTrack) {
            const hPos = trackToCanvas(hTrack, unit, radiusRef.current, r, cx, cy)
            if (hPos) drawTooltip(ctx, hPos.x, hPos.y, hTrack, dpr)
          }
        }
      }

      if (newHovered !== hoveredRef.current) {
        hoveredRef.current = newHovered
        setHoveredTrack(newHovered)
      }

      // 8. Restore (unclip)
      ctx.restore()

      // 9. Outer ring glow
      ctx.strokeStyle = `${SCOPE_GREEN} 0.2)`
      ctx.lineWidth = 2 * dpr
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TWO_PI)
      ctx.stroke()

      // 10. HUD text
      drawHUD(ctx, currentState, radiusRef.current, dpr, canvasSize)

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafRef.current)
  }, [canvasSize, centerX, centerY, canvasRadius, dpr, setHoveredTrack])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = null
    if (hoveredRef.current !== null) {
      hoveredRef.current = null
      setHoveredTrack(null)
    }
  }, [setHoveredTrack])

  return (
    <div className={styles.container} style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        width={canvasSize}
        height={canvasSize}
        className={styles.canvas}
        style={{ width: size, height: size }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  )
}

// ── Drawing helpers ──────────────────────────────────────────

function drawSweepBeam(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sweep: number
): void {
  const trailRad = SWEEP_TRAIL_DEG * DEG_TO_RAD
  const steps = 40

  for (let i = 0; i < steps; i++) {
    const t = i / steps
    const angle = sweep - trailRad * t
    // Map angle to canvas: 0=North, CW
    const canvasAngle = angle - Math.PI / 2

    const alpha = 0.22 * (1 - t) ** 2
    ctx.strokeStyle = `${SCOPE_GREEN} ${alpha})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(canvasAngle) * r, cy + Math.sin(canvasAngle) * r)
    ctx.stroke()
  }

  // Bright leading edge
  const leadAngle = sweep - Math.PI / 2
  const leadGrad = ctx.createLinearGradient(
    cx,
    cy,
    cx + Math.cos(leadAngle) * r,
    cy + Math.sin(leadAngle) * r
  )
  leadGrad.addColorStop(0, `${SCOPE_GREEN} 0)`)
  leadGrad.addColorStop(0.3, `${SCOPE_GREEN} 0.4)`)
  leadGrad.addColorStop(1, `${SCOPE_GREEN} 0.1)`)
  ctx.strokeStyle = leadGrad
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(leadAngle) * r, cy + Math.sin(leadAngle) * r)
  ctx.stroke()
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  timestamp: number
): void {
  const seed = (timestamp * 0.01) | 0
  ctx.fillStyle = `${SCOPE_GREEN} 0.025)`
  for (let i = 0; i < NOISE_POINTS.length; i++) {
    const p = NOISE_POINTS[i]!
    // Slowly drift
    const a = p.angle + seed * 0.001 * ((i % 3) - 1)
    const d = p.dist * r
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d
    ctx.beginPath()
    ctx.arc(x, y, p.size, 0, TWO_PI)
    ctx.fill()
  }
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  track: RadarTrack,
  brightness: number,
  dpr: number
): void {
  const isFriendly = track.affiliation === 'friendly'
  const color = isFriendly ? FRIENDLY_COLOR : HOSTILE_COLOR
  const s = (isFriendly ? 7 : 9) * dpr

  ctx.save()
  ctx.globalAlpha = brightness
  ctx.shadowColor = color
  ctx.shadowBlur = 14 * dpr

  ctx.fillStyle = color
  ctx.beginPath()

  if (isFriendly) {
    // Diamond
    ctx.moveTo(x, y - s)
    ctx.lineTo(x + s * 0.7, y)
    ctx.lineTo(x, y + s)
    ctx.lineTo(x - s * 0.7, y)
  } else {
    // Triangle pointing in heading direction
    const hdg = Math.atan2(track.ve, track.vn)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(hdg)
    ctx.moveTo(0, -s)
    ctx.lineTo(s * 0.6, s * 0.6)
    ctx.lineTo(-s * 0.6, s * 0.6)
    ctx.restore()
  }

  ctx.closePath()
  ctx.fill()

  // Inner glow pass
  ctx.shadowBlur = 6 * dpr
  ctx.fill()

  ctx.restore()
}

function drawVelocityVector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  track: RadarTrack,
  brightness: number,
  dpr: number
): void {
  const speed = Math.sqrt(track.vn ** 2 + track.ve ** 2)
  if (speed < 0.5) return

  const hdg = Math.atan2(track.ve, track.vn)
  const len = Math.min(speed * 0.15 * dpr, 20 * dpr)

  ctx.save()
  ctx.globalAlpha = brightness * 0.6
  ctx.strokeStyle = track.affiliation === 'friendly' ? FRIENDLY_COLOR : HOSTILE_COLOR
  ctx.lineWidth = 1.5 * dpr
  ctx.beginPath()
  ctx.moveTo(x, y)
  // Canvas Y is inverted
  ctx.lineTo(x + Math.sin(hdg) * len, y - Math.cos(hdg) * len)
  ctx.stroke()
  ctx.restore()
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  track: RadarTrack,
  dpr: number
): void {
  const speed = Math.sqrt(track.vn ** 2 + track.ve ** 2)
  const lines = [
    `ID: ${track.id}`,
    `${track.affiliation.toUpperCase()}`,
    `Alt: ${track.alt.toFixed(0)}m`,
    `Spd: ${speed.toFixed(1)} m/s`,
    `RCS: ${track.strength.toFixed(1)} dBsm`,
    `Conf: ${track.confidence.toFixed(0)}%`
  ]

  const fontSize = 10 * dpr
  const padding = 6 * dpr
  const lineHeight = fontSize + 3 * dpr
  const w = 120 * dpr
  const h = lines.length * lineHeight + padding * 2

  // Position tooltip offset from track
  let tx = x + 15 * dpr
  let ty = y - h / 2

  // Keep in bounds (rough)
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  if (tx + w > cw) tx = x - w - 15 * dpr
  if (ty < 0) ty = 4 * dpr
  if (ty + h > ch) ty = ch - h - 4 * dpr

  ctx.save()
  ctx.globalAlpha = 0.92

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.strokeStyle = `${SCOPE_GREEN} 0.3)`
  ctx.lineWidth = 1 * dpr
  ctx.beginPath()
  ctx.roundRect(tx, ty, w, h, 4 * dpr)
  ctx.fill()
  ctx.stroke()

  // Text
  ctx.font = `${fontSize}px monospace`
  ctx.fillStyle = `${SCOPE_GREEN} 0.8)`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (let i = 0; i < lines.length; i++) {
    const lineColor =
      i === 1
        ? track.affiliation === 'friendly'
          ? FRIENDLY_COLOR
          : HOSTILE_COLOR
        : `${SCOPE_GREEN} 0.8)`
    ctx.fillStyle = lineColor
    ctx.fillText(lines[i]!, tx + padding, ty + padding + i * lineHeight)
  }

  ctx.restore()
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  _radarState: RadarState | null,
  radiusMeters: number,
  dpr: number,
  canvasSize: number
): void {
  const fontSize = 10 * dpr
  const pad = 12 * dpr
  ctx.font = `${fontSize}px monospace`
  ctx.textBaseline = 'top'

  // Top-right: radius
  ctx.textAlign = 'right'
  ctx.fillStyle = `${SCOPE_GREEN} 0.5)`
  const rLabel = radiusMeters >= 1000 ? `${(radiusMeters / 1000).toFixed(1)}km` : `${radiusMeters}m`
  ctx.fillText(`R: ${rLabel}`, canvasSize - pad, pad)
}
