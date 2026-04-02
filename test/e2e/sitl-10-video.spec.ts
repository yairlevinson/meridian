/**
 * SITL E2E: Gazebo video streaming validation.
 * Tests the pipeline: Gazebo camera -> gz-video-stream.py -> UDP 5600 -> Meridian.
 *
 * Requires gz-video-stream.py to be running, or auto-starts it if python3
 * and Gazebo transport bindings are available.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected } from './helpers/sitlHelpers'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'

test.skip(!useSitl, 'SITL-only tests')

let videoProcess: ChildProcess | null = null

function startVideoStream(): ChildProcess | null {
  const scriptPath = path.resolve(__dirname, '../../scripts/gz-video-stream.py')
  try {
    const proc = spawn(
      'python3',
      [scriptPath, '--port', '5600', '--model', 'x500_depth_0', '--sensor', 'depth_camera'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: {
          ...process.env,
          GZ_IP: '127.0.0.1'
        }
      }
    )

    proc.stdout?.on('data', (buf: Buffer) => {
      console.log(`[gz-video] ${buf.toString().trim()}`)
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      console.log(`[gz-video err] ${buf.toString().trim()}`)
    })

    return proc
  } catch {
    console.log('[sitl-10-video] Could not start gz-video-stream.py')
    return null
  }
}

test.describe.serial('PX4 SITL Gazebo Video', () => {
  test.beforeAll(() => {
    videoProcess = startVideoStream()
  })

  test.afterAll(() => {
    if (videoProcess?.pid) {
      try {
        process.kill(-videoProcess.pid, 'SIGTERM')
      } catch {
        // Already dead
      }
    }
    videoProcess = null
  })

  test('start video stream from Gazebo bridge', async ({ page }) => {
    test.skip(!videoProcess, 'gz-video-stream.py could not be started')
    await waitConnected(page)

    // Give gz-video-stream.py time to connect to Gazebo and start encoding
    await page.waitForTimeout(5000)

    // Start video in Meridian
    await page.evaluate(() => window.bridge.videoStart('udp_h264', 'udp://@:5600'))

    // Wait for streaming state
    await expect(async () => {
      const state = (await page.evaluate(() => window.bridge.videoGetState())) as any
      expect(state?.streaming).toBe(true)
    }).toPass({ timeout: 15_000 })
  })

  test('video element is visible in UI', async ({ page }) => {
    test.skip(!videoProcess, 'gz-video-stream.py could not be started')

    // The VideoView component renders a <video> element
    const video = page.locator('video')
    await expect(video).toBeVisible({ timeout: 10_000 })
  })

  test('stop and restart video', async ({ page }) => {
    test.skip(!videoProcess, 'gz-video-stream.py could not be started')

    // Stop
    await page.evaluate(() => window.bridge.videoStop())
    await page.waitForTimeout(1000)

    let state = (await page.evaluate(() => window.bridge.videoGetState())) as any
    expect(state?.streaming).toBeFalsy()

    // Restart
    await page.evaluate(() => window.bridge.videoStart('udp_h264', 'udp://@:5600'))

    await expect(async () => {
      state = (await page.evaluate(() => window.bridge.videoGetState())) as any
      expect(state?.streaming).toBe(true)
    }).toPass({ timeout: 15_000 })
  })

  test('video can be stopped cleanly', async ({ page }) => {
    test.skip(!videoProcess, 'gz-video-stream.py could not be started')

    await page.evaluate(() => window.bridge.videoStop())
    await page.waitForTimeout(500)

    const state = (await page.evaluate(() => window.bridge.videoGetState())) as any
    expect(state?.streaming).toBeFalsy()
  })
})
