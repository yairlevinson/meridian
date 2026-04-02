import { useMemo } from 'react'
import { useParameterStore } from '../../store/parameterStore'
import { getMotorLayout, FRAME_CLASS_NAMES, FRAME_TYPE_NAMES } from './motorLayouts'
import styles from './ActuatorsPage.module.css'

interface Props {
  highlightMotor?: number // 1-based motor number to highlight (during identification)
}

export function MotorSpinDirection({ highlightMotor }: Props): React.JSX.Element {
  const parameters = useParameterStore((s) => s.parameters)
  const loadState = useParameterStore((s) => s.loadState)

  const frameClass = parameters.get('FRAME_CLASS')?.value ?? 0
  const frameType = parameters.get('FRAME_TYPE')?.value ?? 0

  const layout = useMemo(() => getMotorLayout(frameClass, frameType), [frameClass, frameType])

  const frameLabel = `${FRAME_CLASS_NAMES[frameClass] ?? 'Unknown'} ${FRAME_TYPE_NAMES[frameType] ?? ''}`

  if (!loadState.parametersReady) {
    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Motor Layout</span>
        <div className={styles.configLoading}>Waiting for parameters...</div>
      </div>
    )
  }

  if (!layout) {
    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Motor Layout</span>
        <div className={styles.configLoading}>
          No diagram available for frame class {frameClass}
          {FRAME_CLASS_NAMES[frameClass] ? ` (${FRAME_CLASS_NAMES[frameClass]})` : ''}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Motor Layout</span>
        <span className={styles.frameLabel}>{frameLabel}</span>
      </div>

      <div className={styles.diagramContainer}>
        {/* Front indicator */}
        <div className={styles.diagramFront}>FRONT</div>

        {/* Vehicle body (center cross) */}
        <svg className={styles.diagramSvg} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          {/* Arms from center to each motor */}
          {layout.map((m, i) => (
            <line
              key={`arm-${i}`}
              x1="50"
              y1="50"
              x2={m.x}
              y2={m.y}
              stroke="var(--border-default)"
              strokeWidth="1.5"
            />
          ))}

          {/* Center body */}
          <circle
            cx="50"
            cy="50"
            r="4"
            fill="var(--bg-elevated)"
            stroke="var(--border-default)"
            strokeWidth="1"
          />

          {/* Front direction arrow */}
          <line
            x1="50"
            y1="46"
            x2="50"
            y2="38"
            stroke="var(--text-dimmed)"
            strokeWidth="1"
            markerEnd="url(#arrowhead)"
          />
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="var(--text-dimmed)" />
            </marker>
          </defs>

          {/* Motors */}
          {layout.map((m, i) => {
            const isHighlighted = highlightMotor === Number(m.label)
            const fillColor = isHighlighted ? '#ffab40' : m.cw ? 'var(--accent-blue)' : '#4ec3e8'

            return (
              <g key={`motor-${i}`}>
                {/* Motor circle */}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={6}
                  fill={fillColor}
                  opacity={isHighlighted ? 1 : 0.8}
                  stroke={isHighlighted ? '#fff' : 'none'}
                  strokeWidth={isHighlighted ? 1.5 : 0}
                />

                {/* Motor number */}
                <text
                  x={m.x}
                  y={m.y + 1.2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  fontSize="5"
                  fontFamily="var(--font-mono)"
                  fontWeight="bold"
                >
                  {m.label}
                </text>

                {/* CW/CCW arc arrow */}
                {m.cw ? (
                  <path
                    d={cwArc(m.x, m.y, 9)}
                    fill="none"
                    stroke={fillColor}
                    strokeWidth="0.8"
                    markerEnd="url(#arrowTip)"
                  />
                ) : (
                  <path
                    d={ccwArc(m.x, m.y, 9)}
                    fill="none"
                    stroke={fillColor}
                    strokeWidth="0.8"
                    markerEnd="url(#arrowTip)"
                  />
                )}
              </g>
            )
          })}

          <defs>
            <marker
              id="arrowTip"
              markerWidth="4"
              markerHeight="3"
              refX="4"
              refY="1.5"
              orient="auto"
            >
              <polygon points="0 0, 4 1.5, 0 3" fill="var(--accent-blue)" />
            </marker>
          </defs>
        </svg>

        {/* Legend */}
        <div className={styles.diagramLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: 'var(--accent-blue)' }} />
            CW
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#4ec3e8' }} />
            CCW
          </span>
        </div>
      </div>
    </div>
  )
}

/** Generate a CW arc path (partial circle) around (cx, cy) with radius r */
function cwArc(cx: number, cy: number, r: number): string {
  // Arc from ~-60° to ~240° (CW direction)
  const startAngle = -60 * (Math.PI / 180)
  const endAngle = 200 * (Math.PI / 180)
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`
}

/** Generate a CCW arc path (partial circle) around (cx, cy) with radius r */
function ccwArc(cx: number, cy: number, r: number): string {
  const startAngle = -60 * (Math.PI / 180)
  const endAngle = 200 * (Math.PI / 180)
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  return `M ${x1} ${y1} A ${r} ${r} 0 1 0 ${x2} ${y2}`
}
