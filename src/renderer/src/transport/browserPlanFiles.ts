import type { PlanFile } from '@shared/ipc/MissionTypes'
import { validatePlanFile } from '@shared/ipc/PlanFileValidation'

export function serializePlanFile(planData: PlanFile): string {
  return JSON.stringify(planData, null, 2)
}

export function parsePlanFileText(text: string, source = 'plan file'): PlanFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON in ${source}`)
  }

  if (!validatePlanFile(parsed)) {
    throw new Error(`Invalid plan file format: ${source}`)
  }

  return parsed
}

export async function savePlanToBrowserDownload(
  planData: PlanFile,
  fileName = 'meridian.plan'
): Promise<{ filePath: string }> {
  const blob = new Blob([serializePlanFile(planData)], { type: 'application/json' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')

  try {
    link.href = url
    link.download = fileName
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    return { filePath: fileName }
  } finally {
    link.remove()
    window.URL.revokeObjectURL(url)
  }
}

export function openPlanFromBrowserFile(): Promise<PlanFile | { cancelled: true }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')

    const cleanup = (): void => {
      input.remove()
    }

    input.type = 'file'
    input.accept = '.plan,application/json'
    input.style.display = 'none'
    input.addEventListener('cancel', () => {
      cleanup()
      resolve({ cancelled: true })
    })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        cleanup()
        resolve({ cancelled: true })
        return
      }

      void file
        .text()
        .then((text) => resolve(parsePlanFileText(text, file.name)))
        .catch(reject)
        .finally(cleanup)
    })

    document.body.appendChild(input)
    input.click()
  })
}
