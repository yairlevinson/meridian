/**
 * Mission tests specifically designed to validate SITL integration.
 * Works with both SyntheticVehicle (default) and real PX4 SITL.
 *
 * Run with SyntheticVehicle:  npx playwright test sitl-mission
 * Run with PX4 SITL:          GC_E2E_SITL=1 npx playwright test sitl-mission
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'

async function waitConnected(page: import('@playwright/test').Page): Promise<void> {
  await expect(async () => {
    const text = await page.textContent('body')
    expect(text).toContain('Connected')
  }).toPass({ timeout: useSitl ? 30_000 : 10_000 })
}

test.describe('Mission execution', () => {
  test('connects and shows vehicle telemetry', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()
    await waitConnected(page)
  })

  test('vehicle appears on the map at its GPS position', async ({ page, syntheticVehicle }) => {
    // PX4 SIH in 'none' mode has no GPS — no GLOBAL_POSITION_INT, same as real QGroundControl behavior
    test.skip(useSitl, 'PX4 SIH (none sim) has no GPS — vehicle cannot appear on map')
    syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 14 })
    await waitConnected(page)

    // Wait for GPS data to be available via vehicle store
    await expect(async () => {
      const gps = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return store?.getState()?.vehicles?.[1]?.gps
      })
      expect(gps).toBeTruthy()
      expect(gps.lat).toBeGreaterThan(42.0)
      expect(gps.lat).toBeLessThan(43.0)
    }).toPass({ timeout: 10_000 })

    // Wait for the vehicle marker to appear on the map
    const marker = page.locator('[title="Vehicle 1"]')
    await expect(marker).toBeVisible({ timeout: 10_000 })
  })

  test('uploads a mission via IPC and gets success', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()
    await waitConnected(page)

    const result = await page.evaluate(async () => {
      const items = [
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
          x: Math.round(42.3905 * 1e7),
          y: Math.round(-71.1465 * 1e7),
          z: 50,
          missionType: 0
        }
      ]
      return await window.bridge.missionWrite(1, items)
    })

    expect((result as any)?.success).toBe(true)
  })

  test('upload then download round-trip preserves items', async ({ page, syntheticVehicle }) => {
    if (!useSitl) syntheticVehicle!.startStreaming()
    await waitConnected(page)

    await page.evaluate(async () => {
      const items = [
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
      return await window.bridge.missionWrite(1, items)
    })

    const downloaded = await page.evaluate(async () => {
      return await window.bridge.missionLoad(1)
    })

    const items = (downloaded as any)?.items
    expect(items).toHaveLength(2)
    expect(items[0].z).toBe(50)
    expect(items[1].z).toBe(60)
  })
})
