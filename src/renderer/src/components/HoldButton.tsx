import { useCallback, useRef, useState } from 'react'

interface HoldButtonProps {
  onConfirm: () => void
  holdDurationMs?: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

/**
 * A button that requires the user to press and hold to confirm a dangerous action.
 * Shows a fill progress indicator while held.
 */
export function HoldButton({
  onConfirm,
  holdDurationMs = 1500,
  className,
  style,
  children
}: HoldButtonProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const confirmedRef = useRef(false)

  const tick = useCallback(() => {
    if (startTimeRef.current === null) return
    const elapsed = Date.now() - startTimeRef.current
    const pct = Math.min(elapsed / holdDurationMs, 1)
    setProgress(pct)
    if (pct >= 1 && !confirmedRef.current) {
      confirmedRef.current = true
      onConfirm()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [holdDurationMs, onConfirm])

  const handlePointerDown = useCallback(() => {
    confirmedRef.current = false
    startTimeRef.current = Date.now()
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const handlePointerUp = useCallback(() => {
    startTimeRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setProgress(0)
  }, [])

  return (
    <button
      className={className}
      style={{
        ...style,
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'none'
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background: style?.borderColor ?? '#ff0000',
          opacity: 0.3,
          transformOrigin: 'left',
          transform: `scaleX(${progress})`,
          transition: progress === 0 ? 'transform 0.15s' : 'none',
          pointerEvents: 'none'
        }}
      />
      <span style={{ position: 'relative' }}>{children}</span>
    </button>
  )
}
