import { promises as fs } from 'fs'
import type { PlanFile } from '@shared/ipc/MissionTypes'
export { validatePlanFile } from '@shared/ipc/PlanFileValidation'
import { validatePlanFile } from '@shared/ipc/PlanFileValidation'

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
