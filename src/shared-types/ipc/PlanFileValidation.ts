import type { PlanFile } from './MissionTypes'

export function validatePlanFile(data: unknown): data is PlanFile {
  if (typeof data !== 'object' || data === null) return false

  const obj = data as Record<string, unknown>

  if (typeof obj.fileHeader !== 'object' || obj.fileHeader === null) return false
  const header = obj.fileHeader as Record<string, unknown>
  if (typeof header.version !== 'number') return false

  if (typeof obj.mission !== 'object' || obj.mission === null) return false
  const mission = obj.mission as Record<string, unknown>
  if (!Array.isArray(mission.items)) return false

  for (const item of mission.items) {
    if (typeof item !== 'object' || item === null) return false
    const mi = item as Record<string, unknown>
    if (typeof mi.seq !== 'number') return false
    if (typeof mi.frame !== 'number') return false
    if (typeof mi.command !== 'number') return false
    if (typeof mi.x !== 'number') return false
    if (typeof mi.y !== 'number') return false
    if (typeof mi.z !== 'number') return false
  }

  return true
}
