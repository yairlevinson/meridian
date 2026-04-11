import { test, expect, useSitl } from './fixtures/vehicleFixture'

test.describe('Mission Planning E2E', () => {
  test('navigate to Plan view and verify sidebar appears', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()

    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('MISSION')
    }).toPass({ timeout: 5000 })
  })

  test('switch between Fly and Plan views', async ({ page, syntheticVehicle }) => {
    if (useSitl) {
      await expect(async () => {
        const text = await page.textContent('body')
        expect(text).toContain('Connected')
      }).toPass({ timeout: 30_000 })
    } else {
      syntheticVehicle!.sendHeartbeat()
      await expect(async () => {
        const text = await page.textContent('body')
        expect(text).toContain('Connected')
      }).toPass({ timeout: 5000 })
    }

    // Switch to Plan
    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('MISSION')
    }).toPass({ timeout: 3000 })

    // Switch back to Fly
    await page.click('button:has-text("FLY")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Connected')
    }).toPass({ timeout: 3000 })
  })

  test('mission stats panel visible with zero waypoints', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()

    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('STATS')
      expect(text).toContain('Waypoints')
      expect(text).toMatch(/Distance/)
    }).toPass({ timeout: 5000 })

    const countEl = page.locator('[data-testid="stats-count"]')
    await expect(countEl).toHaveText('0')
  })

  test('mission toolbar shows action buttons', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()

    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Upload')
      expect(text).toContain('Download')
      expect(text).toContain('Save')
      expect(text).toContain('Clear')
    }).toPass({ timeout: 5000 })
  })

  test('empty mission shows helper text', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()

    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Click the map to add your first waypoint')
    }).toPass({ timeout: 5000 })
  })
})
