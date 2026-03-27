import { test, expect, useSitl } from './fixtures/vehicleFixture'

test.describe('Meridian E2E', () => {
  test('shows WAITING state before any packets arrive', async ({ page }) => {
    test.skip(useSitl, 'SITL sends packets immediately — no WAITING state')
    const text = await page.textContent('body')
    expect(text).toContain('WAITING')
  })

  test('shows CONNECTED after receiving HEARTBEAT', async ({ page, syntheticVehicle }) => {
    if (useSitl) {
      // SITL sends heartbeats automatically
      await expect(async () => {
        const text = await page.textContent('body')
        expect(text).toContain('CONNECTED')
      }).toPass({ timeout: 30_000 })
      return
    }

    syntheticVehicle!.sendHeartbeat()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: 5000 })
  })

  test('displays attitude values from ATTITUDE messages', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific attitude values via SyntheticVehicle')

    syntheticVehicle!.sendHeartbeat()
    const sendAttitude = (): void => {
      syntheticVehicle!.sendAttitude(0.2618, 0.0873, 1.5708) // ~15° roll, ~5° pitch, ~90° yaw
    }
    sendAttitude()
    const iv = setInterval(sendAttitude, 50)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
      expect(text).toMatch(/Roll:\s*1[45]\.\d/)
    }).toPass({ timeout: 5000 })

    clearInterval(iv)

    const text = await page.textContent('body')
    expect(text).toMatch(/Pitch:\s*[45]\.\d/)
    expect(text).toMatch(/Yaw:\s*90\.\d/)
  })

  test('displays GPS coordinates from GLOBAL_POSITION_INT messages', async ({
    page,
    syntheticVehicle
  }) => {
    test.skip(useSitl, 'Test sends specific GPS values via SyntheticVehicle')

    const sendAll = (): void => {
      syntheticVehicle!.sendHeartbeat()
      syntheticVehicle!.sendPosition(42.3898, -71.1476, 100)
    }
    sendAll()
    const iv = setInterval(sendAll, 100)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('42.389')
      expect(text).toContain('-71.147')
      expect(text).toContain('100.0m')
    }).toPass({ timeout: 15000 })

    clearInterval(iv)
  })

  test('shows DISARMED when vehicle is disarmed', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heartbeat via SyntheticVehicle')

    syntheticVehicle!.sendHeartbeat(false)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('DISARMED')
    }).toPass({ timeout: 5000 })
  })

  test('shows ARMED when vehicle is armed', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heartbeat via SyntheticVehicle')

    const sendArmed = (): void => syntheticVehicle!.sendHeartbeat(true)
    sendArmed()
    const iv = setInterval(sendArmed, 200)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toMatch(/[^DIS]ARMED/)
    }).toPass({ timeout: 5000 })

    clearInterval(iv)
  })

  test('updates telemetry continuously during streaming', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test checks SyntheticVehicle-specific merge counters')

    syntheticVehicle!.startStreaming()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: 5000 })

    await page.waitForTimeout(2000)
    const text = await page.textContent('body')
    const match = text?.match(/Store merges:(\d+)/)
    expect(match).toBeTruthy()
    const mergeCount = parseInt(match![1], 10)
    expect(mergeCount).toBeGreaterThan(10)
  })

  test('FPS stays above 50 during streaming', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming()
    }

    await page.waitForTimeout(3000)

    const text = await page.textContent('body')
    const fpsMatch = text?.match(/FPS:\s*(\d+)/)
    expect(fpsMatch).toBeTruthy()
    const fps = parseInt(fpsMatch![1], 10)
    expect(fps).toBeGreaterThan(useSitl ? 30 : 50)
  })

  test('IPC latency stays under 40ms during streaming', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming()
    }

    await page.waitForTimeout(2000)

    const text = await page.textContent('body')
    const latencyMatch = text?.match(/IPC latency:\s*(\d+)ms/)
    expect(latencyMatch).toBeTruthy()
    const latency = parseInt(latencyMatch![1], 10)
    expect(latency).toBeLessThan(40)
  })

  test('Compass displays heading from VFR_HUD', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heading values via SyntheticVehicle')

    const sendAll = (): void => {
      syntheticVehicle!.sendHeartbeat()
      syntheticVehicle!.sendVfrHud({
        heading: 135,
        groundspeed: 5,
        throttle: 40,
        alt: 50,
        climb: 0
      })
    }
    sendAll()
    const iv = setInterval(sendAll, 200)

    await expect(async () => {
      const compass = page.locator('svg[aria-label="Heading 135°"]')
      await expect(compass).toBeVisible()
    }).toPass({ timeout: 5000 })

    clearInterval(iv)
  })

  test('Compass heading updates when heading changes', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heading values via SyntheticVehicle')

    // Send heading 90
    const sendHdg90 = (): void => {
      syntheticVehicle!.sendHeartbeat()
      syntheticVehicle!.sendVfrHud({ heading: 90, groundspeed: 5, throttle: 40, alt: 50, climb: 0 })
    }
    sendHdg90()
    const iv1 = setInterval(sendHdg90, 200)

    await expect(async () => {
      const compass = page.locator('svg[aria-label="Heading 90°"]')
      await expect(compass).toBeVisible()
    }).toPass({ timeout: 5000 })

    clearInterval(iv1)

    // Change to heading 270
    const sendHdg270 = (): void => {
      syntheticVehicle!.sendHeartbeat()
      syntheticVehicle!.sendVfrHud({
        heading: 270,
        groundspeed: 5,
        throttle: 40,
        alt: 50,
        climb: 0
      })
    }
    sendHdg270()
    const iv2 = setInterval(sendHdg270, 200)

    await expect(async () => {
      const compass = page.locator('svg[aria-label="Heading 270°"]')
      await expect(compass).toBeVisible()
    }).toPass({ timeout: 5000 })

    clearInterval(iv2)
  })

  test('PiP minimize hides content, restore shows it', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming()
    }

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: useSitl ? 30_000 : 5000 })

    // PiP body should be visible initially
    const pipBody = page.locator('[data-testid="pip-body"]')
    await expect(pipBody).toBeVisible({ timeout: 3000 })

    // Click minimize
    const minimizeBtn = page.locator('[data-testid="pip-minimize"]')
    await minimizeBtn.click()

    // PiP body should be hidden, but container and toolbar remain
    await expect(pipBody).not.toBeVisible()
    const pipContainer = page.locator('[data-testid="pip-container"]')
    await expect(pipContainer).toBeVisible()

    // Click restore
    await minimizeBtn.click()

    // PiP body should be visible again
    await expect(pipBody).toBeVisible()
  })

  test('PiP is draggable', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming()
    }

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: useSitl ? 30_000 : 5000 })

    const pipContainer = page.locator('[data-testid="pip-container"]')
    await expect(pipContainer).toBeVisible({ timeout: 3000 })

    const box = await pipContainer.boundingBox()
    expect(box).toBeTruthy()

    // Drag the toolbar 100px left and 50px up
    const startX = box!.x + box!.width / 2
    const startY = box!.y + 12 // middle of the 24px toolbar
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 100, startY - 50, { steps: 5 })
    await page.mouse.up()

    const newBox = await pipContainer.boundingBox()
    expect(newBox).toBeTruthy()
    // Position should have changed
    expect(newBox!.x).toBeLessThan(box!.x)
    expect(newBox!.y).toBeLessThan(box!.y)
  })

  test('PiP is resizable via corner handle', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming()
    }

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: useSitl ? 30_000 : 5000 })

    const pipBody = page.locator('[data-testid="pip-body"]')
    await expect(pipBody).toBeVisible({ timeout: 3000 })

    const beforeBox = await pipBody.boundingBox()
    expect(beforeBox).toBeTruthy()

    const handle = page.locator('[data-testid="pip-resize"]')
    const handleBox = await handle.boundingBox()
    expect(handleBox).toBeTruthy()

    // Drag handle 80px right and 60px down
    const hx = handleBox!.x + handleBox!.width / 2
    const hy = handleBox!.y + handleBox!.height / 2
    await page.mouse.move(hx, hy)
    await page.mouse.down()
    await page.mouse.move(hx + 80, hy + 60, { steps: 5 })
    await page.mouse.up()

    const afterBox = await pipBody.boundingBox()
    expect(afterBox).toBeTruthy()
    expect(afterBox!.width).toBeGreaterThan(beforeBox!.width)
    expect(afterBox!.height).toBeGreaterThan(beforeBox!.height)
  })

  test('takes a screenshot for visual regression', async ({ page, syntheticVehicle }) => {
    if (!useSitl) {
      syntheticVehicle!.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 50, armed: false })
    }

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('CONNECTED')
    }).toPass({ timeout: useSitl ? 30_000 : 5000 })

    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test/e2e/screenshots/meridian.png' })
  })
})
