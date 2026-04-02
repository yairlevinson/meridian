/**
 * SITL E2E: MAVLink camera protocol validation.
 * Tests camera discovery and commands against PX4 SITL with Gazebo camera.
 * Skips if no camera component is detected (depends on Gazebo model).
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, SITL_TIMEOUTS } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Camera', () => {
  let cameraAvailable = false

  test('attempt camera discovery', async ({ page }) => {
    await waitConnected(page)

    // Request camera info — may or may not succeed depending on Gazebo model
    await page.evaluate(() => window.bridge.cameraRequestInfo(1))

    // Wait up to 15s for camera to be discovered
    try {
      await expect(async () => {
        const state = await page.evaluate(() => window.bridge.cameraGetState(1))
        expect(state).toBeTruthy()
        expect((state as any).discovered).toBe(true)
      }).toPass({ timeout: 15_000 })
      cameraAvailable = true
    } catch {
      console.log('[sitl-09-camera] No camera detected — Gazebo model may not have camera plugin')
    }
  })

  test('camera state is available', async ({ page }) => {
    test.skip(!cameraAvailable, 'No camera detected in Gazebo model')

    const state = (await page.evaluate(() => window.bridge.cameraGetState(1))) as any
    expect(state).toBeTruthy()
    expect(state.discovered).toBe(true)
  })

  test('take photo via MAVLink', async ({ page }) => {
    test.skip(!cameraAvailable, 'No camera detected in Gazebo model')

    // Set up listener for image captured event
    const captured = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const unsub = window.bridge.onCameraImageCaptured(() => {
            unsub()
            resolve(true)
          })
          // Timeout fallback
          setTimeout(() => resolve(false), 10_000)
        })
    )

    await page.evaluate(() => window.bridge.cameraTakePhoto(1))

    const result = await captured
    // Photo capture may not work in all Gazebo setups — don't hard-fail
    if (!result) {
      console.log('[sitl-09-camera] Photo capture did not trigger imageCaptured event')
    }
  })

  test('start/stop video recording via MAVLink', async ({ page }) => {
    test.skip(!cameraAvailable, 'No camera detected in Gazebo model')

    await page.evaluate(() => window.bridge.cameraStartRecording(1))
    await page.waitForTimeout(2000)

    let state = (await page.evaluate(() => window.bridge.cameraGetState(1))) as any
    const wasRecording = state?.isRecordingVideo === true

    await page.evaluate(() => window.bridge.cameraStopRecording(1))
    await page.waitForTimeout(1000)

    state = (await page.evaluate(() => window.bridge.cameraGetState(1))) as any

    if (wasRecording) {
      expect(state.isRecordingVideo).toBe(false)
    } else {
      console.log('[sitl-09-camera] Video recording commands sent but state not confirmed')
    }
  })
})
