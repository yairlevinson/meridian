import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { SyntheticVehicle } from './helpers/SyntheticVehicle'

const VEHICLE_COUNT = 10

// Multi-vehicle tests require multiple SyntheticVehicles — skip in SITL mode
test.skip(useSitl, 'Multi-vehicle tests require SyntheticVehicle (skipped in SITL mode)')

// Extra vehicles created during tests (beyond the fixture's syntheticVehicle)
let extraVehicles: SyntheticVehicle[] = []

test.afterEach(() => {
  for (const v of extraVehicles) v.stop()
  extraVehicles = []
})

function createVehicles(port: number, count: number): SyntheticVehicle[] {
  const result: SyntheticVehicle[] = []
  for (let i = 1; i <= count; i++) {
    const v = new SyntheticVehicle(port, i)
    result.push(v)
    extraVehicles.push(v)
  }
  return result
}

test.describe('Multi-Vehicle E2E', () => {
  test('connects 10 vehicles and all appear in store', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, VEHICLE_COUNT)

    for (let i = 0; i < vees.length; i++) {
      vees[i].startStreaming({
        lat: 42.389 + i * 0.001,
        lon: -71.147 + i * 0.001,
        alt: 50 + i * 10
      })
    }

    await expect(async () => {
      const count = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).length
      })
      expect(count).toBe(VEHICLE_COUNT)
    }).toPass({ timeout: 10000 })
  })

  test('vehicle appears in store as soon as it connects', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 1)
    vees[0].startStreaming()

    await expect(async () => {
      const ids = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).map(Number)
      })
      expect(ids).toContain(1)
    }).toPass({ timeout: 5000 })

    // Add a second vehicle
    const v2 = new SyntheticVehicle(testPort, 2)
    extraVehicles.push(v2)
    v2.startStreaming({ lat: 42.39, lon: -71.146, alt: 80 })

    await expect(async () => {
      const ids = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).map(Number)
      })
      expect(ids).toContain(1)
      expect(ids).toContain(2)
    }).toPass({ timeout: 5000 })
  })

  test('switching active vehicle updates telemetry', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 2)
    vees[0].startStreaming({ lat: 42.389, lon: -71.147, alt: 50, armed: false })
    vees[1].startStreaming({ lat: 43.0, lon: -72.0, alt: 200, armed: true })

    await expect(async () => {
      const ids = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).map(Number)
      })
      expect(ids).toContain(1)
      expect(ids).toContain(2)
    }).toPass({ timeout: 10000 })

    // Vehicle 1 is active by default — verify its telemetry
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toContain('Disarmed')
    }).toPass({ timeout: 5000 })

    // Switch to vehicle 2 via store
    await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      store.getState().setActiveVehicle(2)
    })
    await page.waitForTimeout(500)

    await expect(async () => {
      const body = await page.textContent('body')
      // Vehicle 2 is armed
      expect(body).not.toContain('Disarmed')
      expect(body).toContain('Armed')
    }).toPass({ timeout: 5000 })
  })

  test('each vehicle has independent state', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 3)
    vees[0].startStreaming({ lat: 10.0, lon: 20.0, alt: 100 })
    vees[1].startStreaming({ lat: 30.0, lon: 40.0, alt: 200 })
    vees[2].startStreaming({ lat: 50.0, lon: 60.0, alt: 300 })

    await expect(async () => {
      const count = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).length
      })
      expect(count).toBe(3)
    }).toPass({ timeout: 10000 })

    // Verify each vehicle's GPS data in store
    const positions = await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      const vehicles = store?.getState()?.vehicles ?? {}
      return Object.entries(vehicles).map(([id, v]: [string, any]) => ({
        id: Number(id),
        lat: v?.gps?.lat ?? 0
      }))
    })

    const v1 = positions.find((p: any) => p.id === 1)
    const v2 = positions.find((p: any) => p.id === 2)
    const v3 = positions.find((p: any) => p.id === 3)
    expect(v1?.lat).toBeCloseTo(10.0, 0)
    expect(v2?.lat).toBeCloseTo(30.0, 0)
    expect(v3?.lat).toBeCloseTo(50.0, 0)
  })

  test('10 vehicles stream concurrently', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, VEHICLE_COUNT)

    for (let i = 0; i < vees.length; i++) {
      vees[i].startStreaming({
        lat: 42.389 + i * 0.001,
        lon: -71.147 + i * 0.001,
        alt: 50 + i * 10
      })
    }

    await expect(async () => {
      const count = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).length
      })
      expect(count).toBe(VEHICLE_COUNT)
    }).toPass({ timeout: 10000 })

    // Let telemetry flow and verify connection is healthy
    await page.waitForTimeout(3000)
    const body = await page.textContent('body')
    expect(body).toContain('Connected')
  })

  test('takes a multi-vehicle screenshot', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, VEHICLE_COUNT)

    for (let i = 0; i < vees.length; i++) {
      vees[i].startStreaming({
        lat: 42.389 + i * 0.001,
        lon: -71.147 + i * 0.001,
        alt: 50 + i * 10
      })
    }

    await expect(async () => {
      const count = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return Object.keys(store?.getState()?.vehicles ?? {}).length
      })
      expect(count).toBe(VEHICLE_COUNT)
    }).toPass({ timeout: 10000 })

    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toContain('Connected')
    }).toPass({ timeout: 5000 })

    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test/e2e/screenshots/multi-vehicle.png' })
  })
})
