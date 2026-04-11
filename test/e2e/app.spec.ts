import { test, expect, useSitl } from './fixtures/vehicleFixture'

test.describe('Meridian E2E', () => {
  test('shows waiting state before any packets arrive', async ({ page }) => {
    test.skip(useSitl, 'SITL sends packets immediately — no waiting state')
    // ConnectionIndicator shows "No vehicle" when no heartbeat received
    const text = await page.textContent('body')
    expect(text).toContain('No vehicle')
  })

  test('shows Connected after receiving HEARTBEAT', async ({ page, syntheticVehicle }) => {
    if (useSitl) {
      await expect(async () => {
        const text = await page.textContent('body')
        expect(text).toContain('Connected')
      }).toPass({ timeout: 30_000 })
      return
    }

    syntheticVehicle!.sendHeartbeat()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Connected')
    }).toPass({ timeout: 5000 })
  })

  test('displays heading from attitude data', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific attitude values via SyntheticVehicle')

    syntheticVehicle!.sendHeartbeat()
    const sendAll = (): void => {
      syntheticVehicle!.sendAttitude(0.2618, 0.0873, 1.5708) // ~15° roll, ~5° pitch, ~90° yaw
      syntheticVehicle!.sendVfrHud({ heading: 90, groundspeed: 5, throttle: 40, alt: 50, climb: 0 })
    }
    sendAll()
    const iv = setInterval(sendAll, 50)

    // FloatingInstruments shows HDG value
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Connected')
      expect(text).toMatch(/HDG\s*90/)
    }).toPass({ timeout: 5000 })

    clearInterval(iv)
  })

  test('displays altitude from GLOBAL_POSITION_INT messages', async ({
    page,
    syntheticVehicle
  }) => {
    test.skip(useSitl, 'Test sends specific GPS values via SyntheticVehicle')

    const sendAll = (): void => {
      syntheticVehicle!.sendHeartbeat()
      syntheticVehicle!.sendPosition(42.3898, -71.1476, 100)
      syntheticVehicle!.sendVfrHud({ heading: 0, groundspeed: 5, throttle: 40, alt: 100, climb: 0 })
    }
    sendAll()
    const iv = setInterval(sendAll, 100)

    // FloatingInstruments shows ALT; GPS coordinates are in store only
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toMatch(/ALT\s*100/)
    }).toPass({ timeout: 15000 })

    clearInterval(iv)
  })

  test('shows Disarmed when vehicle is disarmed', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heartbeat via SyntheticVehicle')

    syntheticVehicle!.sendHeartbeat(false)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Disarmed')
    }).toPass({ timeout: 5000 })
  })

  test('shows Armed when vehicle is armed', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test sends specific heartbeat via SyntheticVehicle')

    const sendArmed = (): void => syntheticVehicle!.sendHeartbeat(true)
    sendArmed()
    const iv = setInterval(sendArmed, 200)

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).not.toContain('Disarmed')
      expect(text).toContain('Armed')
    }).toPass({ timeout: 5000 })

    clearInterval(iv)
  })

  test('updates telemetry continuously during streaming', async ({ page, syntheticVehicle }) => {
    test.skip(useSitl, 'Test checks SyntheticVehicle-specific streaming')

    syntheticVehicle!.startStreaming()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Connected')
    }).toPass({ timeout: 5000 })

    // Verify FloatingInstruments appears with data
    await page.waitForTimeout(2000)
    const text = await page.textContent('body')
    expect(text).toMatch(/SPD/)
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
      const compass = page.locator('svg[aria-label="Heading 135"]')
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
      const compass = page.locator('svg[aria-label="Heading 90"]')
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
      const compass = page.locator('svg[aria-label="Heading 270"]')
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
      expect(text).toContain('Connected')
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
      expect(text).toContain('Connected')
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
      expect(text).toContain('Connected')
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
      expect(text).toContain('Connected')
    }).toPass({ timeout: useSitl ? 30_000 : 5000 })

    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test/e2e/screenshots/meridian.png' })
  })
})
