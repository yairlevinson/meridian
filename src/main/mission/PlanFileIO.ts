import { promises as fs } from 'fs'
import type { PlanFile } from '@shared/ipc/MissionTypes'

export function validatePlanFile(data: unknown): data is PlanFile {
  if (typeof data !== 'object' || data === null) return false

  const obj = data as Record<string, unknown>

  // Check fileHeader
  if (typeof obj.fileHeader !== 'object' || obj.fileHeader === null) return false
  const header = obj.fileHeader as Record<string, unknown>
  if (typeof header.version !== 'number') return false

  // Check mission
  if (typeof obj.mission !== 'object' || obj.mission === null) return false
  const mission = obj.mission as Record<string, unknown>
  if (!Array.isArray(mission.items)) return false

  // Validate each mission item has required numeric fields
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

export async function savePlanFile(filePath: string, plan: PlanFile): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8')
}

export async function loadPlanFile(filePath: string): Promise<PlanFile> {
  const raw = await fs.readFile(filePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in plan file: ${filePath}`)
  }
  if (!validatePlanFile(parsed)) {
    throw new Error(`Invalid plan file format: ${filePath}`)
  }
  return parsed
}
