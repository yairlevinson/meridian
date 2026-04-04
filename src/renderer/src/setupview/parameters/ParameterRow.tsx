import { useState, useCallback, useMemo } from 'react'
import type { Parameter } from '../../../../shared-types/ipc/ParameterTypes'
import {
  getParameterMetadata,
  validateParameterValue
} from '../../../../shared-types/ipc/parameterMetadata'
import styles from './ParameterEditorPage.module.css'

interface Props {
  param: Parameter
  pendingValue: number | undefined
  onValueChange: (name: string, value: number) => void
}

export function ParameterRow({ param, pendingValue, onValueChange }: Props): React.JSX.Element {
  const [editValue, setEditValue] = useState<string | null>(null)
  const displayValue = pendingValue ?? param.value
  const isModified = pendingValue !== undefined

  const meta = useMemo(() => getParameterMetadata(param.name), [param.name])
  const validation = useMemo(
    () =>
      isModified && pendingValue !== undefined
        ? validateParameterValue(param.name, pendingValue)
        : null,
    [param.name, pendingValue, isModified]
  )

  const handleBlur = useCallback(() => {
    if (editValue !== null) {
      const num = parseFloat(editValue)
      if (!isNaN(num) && num !== param.value) {
        onValueChange(param.name, num)
      }
      setEditValue(null)
    }
  }, [editValue, param.name, param.value, onValueChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleBlur()
      } else if (e.key === 'Escape') {
        setEditValue(null)
      }
    },
    [handleBlur]
  )

  // Build range hint string
  const rangeHint = meta
    ? [
        meta.min !== undefined && meta.max !== undefined ? `${meta.min}..${meta.max}` : '',
        meta.units || ''
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return (
    <tr>
      <td className={styles.paramName}>
        {param.name}
        {meta && (
          <span className={styles.paramDesc} title={meta.shortDescription}>
            {' '}
            {meta.shortDescription}
          </span>
        )}
      </td>
      <td>
        <input
          className={`${styles.paramInput} ${isModified ? styles.paramModified : ''} ${validation ? styles.paramInvalid : ''}`}
          type="text"
          value={editValue ?? String(displayValue)}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onFocus={() => setEditValue(String(displayValue))}
          title={validation ?? undefined}
        />
        {validation && <span className={styles.paramValidation}>{validation}</span>}
      </td>
      <td>{rangeHint || param.type}</td>
    </tr>
  )
}
