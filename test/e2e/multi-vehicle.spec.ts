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
  test('connects 10 vehicles and shows vehicle selector', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, VEHICLE_COUNT)

    for (let i = 0; i < vees.length; i++) {
      vees[i].startStreaming({
        lat: 42.389 + i * 0.001,
        lon: -71.147 + i * 0.001,
        alt: 50 + i * 10
      })
    }

    await expect(async () => {
      const text = await page.textContent('body')
      for (let i = 1; i <= VEHICLE_COUNT; i++) {
        expect(text).toContain(`V${i}`)
      }
    }).toPass({ timeout: 10000 })
  })

  test('vehicle selector shows as soon as one vehicle connects', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 1)
    vees[0].startStreaming()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('V1')
    }).toPass({ timeout: 5000 })

    // Add a second vehicle
    const v2 = new SyntheticVehicle(testPort, 2)
    extraVehicles.push(v2)
    v2.startStreaming({ lat: 42.39, lon: -71.146, alt: 80 })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('V1')
      expect(text).toContain('V2')
    }).toPass({ timeout: 5000 })
  })

  test('switching active vehicle updates telemetry display', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 2)
    vees[0].startStreaming({ lat: 42.389, lon: -71.147, alt: 50, armed: false })
    vees[1].startStreaming({ lat: 43.0, lon: -72.0, alt: 200, armed: true })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('V1')
      expect(text).toContain('V2')
    }).toPass({ timeout: 10000 })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('42.389')
      expect(text).toContain('DISARMED')
    }).toPass({ timeout: 5000 })

    await page.click('button:has-text("V2")')
    await page.waitForTimeout(500)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('43.000')
    }).toPass({ timeout: 5000 })
  })

  test('each vehicle has independent state', async ({ page, testPort }) => {
    const vees = createVehicles(testPort, 3)
    vees[0].startStreaming({ lat: 10.0, lon: 20.0, alt: 100 })
    vees[1].startStreaming({ lat: 30.0, lon: 40.0, alt: 200 })
    vees[2].startStreaming({ lat: 50.0, lon: 60.0, alt: 300 })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('V1')
      expect(text).toContain('V2')
      expect(text).toContain('V3')
    }).toPass({ timeout: 10000 })

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('10.000')
      expect(text).toContain('20.000')
    }).toPass({ timeout: 5000 })

    await page.click('button:has-text("V2")')
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('30.000')
      expect(text).toContain('40.000')
    }).toPass({ timeout: 5000 })

    await page.click('button:has-text("V3")')
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('50.000')
      expect(text).toContain('60.000')
    }).toPass({ timeout: 5000 })
  })

  test('10 vehicles stream concurrently without performance degradation', async ({
    page,
    testPort
  }) => {
    const vees = createVehicles(testPort, VEHICLE_COUNT)

    for (let i = 0; i < vees.length; i++) {
      vees[i].startStreaming({
        lat: 42.389 + i * 0.001,
        lon: -71.147 + i * 0.001,
        alt: 50 + i * 10
      })
    }

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain(`V${VEHICLE_COUNT}`)
    }).toPass({ timeout: 10000 })

    await page.waitForTimeout(3000)

    const text = await page.textContent('body')
    const fpsMatch = text?.match(/FPS:\s*(\d+)/)
    expect(fpsMatch).toBeTruthy()
    const fps = parseInt(fpsMatch![1], 10)
    expect(fps).toBeGreaterThan(30)

    const mergeMatch = text?.match(/Store merges:(\d+)/)
    expect(mergeMatch).toBeTruthy()
    const merges = parseInt(mergeMatch![1], 10)
    expect(merges).toBeGreaterThan(50)
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
      const text = await page.textContent('body')
      expect(text).toContain(`V${VEHICLE_COUNT}`)
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: 10000 })

    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test/e2e/screenshots/multi-vehicle.png' })
  })
})
