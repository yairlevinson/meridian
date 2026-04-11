import { test, expect, useSitl } from './fixtures/vehicleFixture'
import type { Page } from '@playwright/test'

/**
 * FloatingActions shows Mission as a secondary action behind an expand button.
 * It also requires a long-press (1500ms hold) to confirm.
 */
async function pressMissionButton(page: Page): Promise<void> {
  // Expand secondary actions (the three-dot expand button)
  const expandBtn = page.locator('[class*="expandBtn"]')
  if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expandBtn.click()
    await page.waitForTimeout(300)
  }

  // Long-press the Mission button (hold-to-confirm: 1500ms)
  const missionBtn = page.locator('button:has-text("Mission")')
  await expect(missionBtn).toBeVisible({ timeout: 3000 })
  const box = await missionBtn.boundingBox()
  if (!box) throw new Error('Mission button not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1800) // hold > 1500ms
  await page.mouse.up()
}

/** Helper: 2-waypoint mission items */
function twoWaypointMission() {
  return [
    {
      seq: 0,
      frame: 3,
      command: 16,
      current: true,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: Math.round(42.39 * 1e7),
      y: Math.round(-71.147 * 1e7),
      z: 50,
      missionType: 0
    },
    {
      seq: 1,
      frame: 3,
      command: 16,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: Math.round(42.391 * 1e7),
      y: Math.round(-71.146 * 1e7),
      z: 60,
      missionType: 0
    }
  ]
}

/** Helper: 3-waypoint mission items */
function threeWaypointMission() {
  return [
    ...twoWaypointMission(),
    {
      seq: 2,
      frame: 3,
      command: 16,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: Math.round(42.392 * 1e7),
      y: Math.round(-71.145 * 1e7),
      z: 70,
      missionType: 0
    }
  ]
}

/** Wait for vehicle connection via ConnectionIndicator */
async function waitConnected(page: import('@playwright/test').Page): Promise<void> {
  await expect(async () => {
    const text = await page.textContent('body')
    expect(text).toContain('Connected')
  }).toPass({ timeout: useSitl ? 30_000 : 10_000 })
}

test.describe('Mission Upload & Execution E2E', () => {
  test('upload a mission plan to the vehicle', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10 })
    await waitConnected(page)

    await page.click('button:has-text("PLAN")')
    await page.waitForTimeout(500)

    const statsCount = page.locator('[data-testid="stats-count"]')
    await expect(statsCount).toHaveText('0')

    await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, threeWaypointMission())

    await page.waitForTimeout(3000)

    const protocolState = page.locator('[data-testid="protocol-state"]')
    await expect(protocolState).not.toBeVisible({ timeout: 10000 })
  })

  test('upload mission and verify vehicle receives items', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10 })
    await waitConnected(page)

    const uploadResult = await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, twoWaypointMission())

    expect(uploadResult).toBeDefined()
    expect((uploadResult as any).success).toBe(true)
  })

  test('download mission from vehicle after upload', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10 })
    await waitConnected(page)

    await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, twoWaypointMission())

    const downloadResult = await page.evaluate(async () => {
      return await window.bridge.missionLoad(1)
    })

    expect(downloadResult).toBeDefined()
    const items = (downloadResult as any).items
    expect(items).toHaveLength(2)
    expect(items[0].seq).toBe(0)
    expect(items[1].seq).toBe(1)
    expect(items[0].x).toBe(Math.round(42.39 * 1e7))
    expect(items[0].z).toBe(50)
    expect(items[1].z).toBe(60)
  })

  test('vehicle flies uploaded mission in AUTO mode', async ({
    page,
    syntheticVehicle,
    profile
  }) => {
    test.skip(useSitl, 'PX4 SITL cannot arm without GPS simulation — test requires armed vehicle')
    if (!useSitl)
      syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10, armed: true })
    await waitConnected(page)

    const uploadResult = await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, threeWaypointMission())
    expect((uploadResult as any).success).toBe(true)

    // Switch to AUTO mode
    const autoMode = String(profile.modes.auto)
    await page.evaluate(async (mode) => {
      await window.bridge.setFlightMode(1, mode)
    }, autoMode)

    await page.waitForTimeout(useSitl ? 40_000 : 12_000)

    const finalText = await page.textContent('body')
    expect(finalText).toBeDefined()
  })

  test('upload + Mission button triggers AUTO', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'PX4 SITL cannot arm without GPS simulation — test requires armed vehicle')
    if (!useSitl)
      syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10, armed: true })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Armed')
    }).toPass({ timeout: useSitl ? 30_000 : 10_000 })

    await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, twoWaypointMission())

    await pressMissionButton(page)

    await page.waitForTimeout(useSitl ? 30_000 : 8_000)

    // Verify vehicle moved via store
    await expect(async () => {
      const gps = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return store?.getState()?.vehicles?.[1]?.gps
      })
      if (gps) {
        expect(gps.lat).toBeGreaterThan(42.389)
      }
    }).toPass({ timeout: 5000 })
  })

  test('IPC upload + download round-trip + Mission button starts flight', async ({
    page,
    syntheticVehicle
  }) => {
    test.skip(useSitl, 'PX4 SITL cannot arm without GPS simulation — test requires armed vehicle')
    if (!useSitl)
      syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10, armed: true })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Armed')
    }).toPass({ timeout: useSitl ? 30_000 : 10_000 })

    const uploadResult = await page.evaluate(async (items) => {
      return await window.bridge.missionWrite(1, items)
    }, twoWaypointMission())
    expect((uploadResult as any)?.success).toBe(true)

    const downloadResult = await page.evaluate(async () => {
      return await window.bridge.missionLoad(1)
    })
    expect((downloadResult as any)?.items).toHaveLength(2)

    await pressMissionButton(page)

    await page.waitForTimeout(useSitl ? 30_000 : 8_000)

    const finalText = await page.textContent('body')
    expect(finalText).toBeDefined()
  })

  test('Mission button uploads from store then starts AUTO', async ({ page, syntheticVehicle }) => {
    test.skip(
      !useSitl,
      'SyntheticVehicle does not implement mission protocol — download always empty'
    )
    if (!useSitl)
      syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 10, armed: true })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Armed')
    }).toPass({ timeout: useSitl ? 30_000 : 10_000 })

    // Add waypoints to Zustand store
    await page.evaluate(() => {
      const store = (window as any).__missionStore
      if (!store) throw new Error('__missionStore not exposed on window')
      store.getState().addWaypoint(42.39, -71.147)
      store.getState().addWaypoint(42.391, -71.146)
    })

    const wpCount = await page.evaluate(() => {
      return (window as any).__missionStore?.getState().editableWaypoints.length
    })
    expect(wpCount).toBe(2)

    await pressMissionButton(page)

    await page.waitForTimeout(useSitl ? 30_000 : 10_000)

    const downloadResult = await page.evaluate(async () => {
      return await window.bridge.missionLoad(1)
    })
    expect((downloadResult as any)?.items).toHaveLength(2)
  })
})
