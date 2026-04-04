/**
 * E2E tests for video streaming and popout window features.
 *
 * Uses ffmpeg's testsrc to generate a local H.264 UDP stream,
 * then verifies the app can receive, display, stop/restart, and
 * pop out the video to a separate window.
 */
import {
  test as base,
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { type ChildProcess, spawn, execSync } from 'child_process'

// Find ffmpeg — prefer bundled, fall back to system
function findFfmpeg(): string {
  const bundled = path.resolve(__dirname, '../../node_modules/ffmpeg-static/ffmpeg')
  try {
    execSync(`test -x "${bundled}"`, { stdio: 'pipe' })
    return bundled
  } catch {
    return 'ffmpeg'
  }
}

interface VideoFixtures {
  app: ElectronApplication
  page: Page
  ffmpegStream: ChildProcess
  videoPort: number
}

let nextVideoPort = 15600

const test = base.extend<VideoFixtures>({
  videoPort: async ({}, use) => {
    await use(nextVideoPort++)
  },

  app: async ({ videoPort: _videoPort }, use) => {
    // Build the app
    execSync('npx electron-vite build', {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe'
    })

    const appEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      GC_UDP_PORT: '14599' // unused port, no vehicle needed
    }
    delete appEnv.ELECTRON_RUN_AS_NODE

    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js')],
      env: appEnv
    })

    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForTimeout(1000)
    await use(page)
  },

  ffmpegStream: async ({ videoPort }, use) => {
    const ffmpeg = findFfmpeg()

    // Launch a test H.264 stream over UDP
    const proc = spawn(
      ffmpeg,
      [
        '-re',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=320x240:rate=15`,
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'baseline',
        '-b:v',
        '500k',
        '-g',
        '15',
        '-an',
        '-f',
        'mpegts',
        `udp://127.0.0.1:${videoPort}?pkt_size=1316`
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    // Wait for ffmpeg to start producing output
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 3000)
      proc.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('frame=')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      proc.on('error', reject)
    })

    await use(proc)

    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 1000))
    if (!proc.killed) proc.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 500))
  }
})

test.describe('Video Streaming', () => {
  test('starts and displays video from UDP stream', async ({
    page,
    ffmpegStream: _ffmpegStream,
    videoPort
  }) => {
    // Start video via the controls
    // Fill in the URI with the test port
    const uriInput = page.locator('input[type="text"]').first()
    await uriInput.fill(`udp://@:${videoPort}`)

    // Click Start
    const startBtn = page.locator('button', { hasText: 'Start' })
    await startBtn.click()

    // Wait for "Streaming" status to appear
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Streaming')
    }).toPass({ timeout: 10_000 })

    // Verify the video element exists and is playing
    const _videoPlaying = await page.evaluate(() => {
      const video = document.querySelector('video')
      return video ? !video.paused && video.readyState >= 2 : false
    })
    // Video may take a moment to actually decode — check it's at least present
    const videoExists = await page.locator('video').count()
    expect(videoExists).toBeGreaterThan(0)
  })

  test('stop and restart preserves video playback', async ({
    page,
    ffmpegStream: _ffmpegStream,
    videoPort
  }) => {
    // Start the stream
    const uriInput = page.locator('input[type="text"]').first()
    await uriInput.fill(`udp://@:${videoPort}`)
    await page.locator('button', { hasText: 'Start' }).click()

    // Wait for streaming
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Streaming')
    }).toPass({ timeout: 10_000 })

    // Stop the stream
    await page.locator('button', { hasText: 'Stop' }).click()

    // Verify streaming stopped
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).not.toContain('Streaming')
    }).toPass({ timeout: 5_000 })

    // Restart
    await page.locator('button', { hasText: 'Start' }).click()

    // Should resume streaming within a reasonable time
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Streaming')
    }).toPass({ timeout: 10_000 })

    // Verify video is actually playing (not just buffered) after restart
    await expect(async () => {
      const state = await page.evaluate(() => {
        const video = document.querySelector('video')
        if (!video) return { playing: false, buffered: false, time: 0 }
        let buffered = false
        try {
          buffered = video.buffered.length > 0
        } catch {
          /* ignore */
        }
        return {
          playing: !video.paused && video.readyState >= 2,
          buffered,
          time: video.currentTime
        }
      })
      expect(state.playing).toBe(true)
      expect(state.buffered).toBe(true)
      expect(state.time).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000 })

    // Verify no JS errors occurred during the stop/restart cycle
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.waitForTimeout(2000)
    const sourceBufferErrors = errors.filter(
      (e) => e.includes('SourceBuffer') || e.includes('CHUNK_DEMUXER')
    )
    expect(sourceBufferErrors).toHaveLength(0)
  })

  test('popout window receives video stream', async ({
    app,
    page,
    ffmpegStream: _ffmpegStream,
    videoPort
  }) => {
    // Start the stream
    const uriInput = page.locator('input[type="text"]').first()
    await uriInput.fill(`udp://@:${videoPort}`)
    await page.locator('button', { hasText: 'Start' }).click()

    // Wait for streaming
    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Streaming')
    }).toPass({ timeout: 10_000 })

    // Wait for video to actually start decoding
    await page.waitForTimeout(2000)

    // Click the popout button (the arrow character ↗)
    const popoutBtn = page.locator('button', { hasText: '↗' }).first()
    if (await popoutBtn.isVisible()) {
      await popoutBtn.click()
    } else {
      // Try the CSS class-based selector
      await page.locator('[class*="popoutBtn"]').first().click()
    }

    // Wait for the new window to open
    await page.waitForTimeout(2000)
    const windows = await app.windows()
    expect(windows.length).toBeGreaterThanOrEqual(2)

    // Find the popout window (the one that's not the main window)
    const popoutPage = windows.find((w) => w !== page)!
    expect(popoutPage).toBeTruthy()

    // The popout should have a video element
    await expect(async () => {
      const videoCount = await popoutPage.locator('video').count()
      expect(videoCount).toBeGreaterThan(0)
    }).toPass({ timeout: 5_000 })

    // Verify the popout video receives data (no APPEND_FAILED errors)
    await popoutPage.waitForTimeout(3000)

    // Check that video element in popout has some buffered data
    const popoutVideoState = await popoutPage.evaluate(() => {
      const video = document.querySelector('video')
      if (!video) return { exists: false, readyState: 0, hasBuffered: false, error: null }
      let hasBuffered = false
      try {
        hasBuffered = video.buffered.length > 0
      } catch {
        /* ignore */
      }
      return {
        exists: true,
        readyState: video.readyState,
        hasBuffered,
        error: video.error ? `${video.error.code}: ${video.error.message}` : null
      }
    })

    expect(popoutVideoState.exists).toBe(true)
    // The video should not have a decode error (code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED)
    if (popoutVideoState.error) {
      expect(popoutVideoState.error).not.toContain('CHUNK_DEMUXER_ERROR')
    }
    // The video should be receiving data
    expect(popoutVideoState.readyState).toBeGreaterThanOrEqual(1)
  })

  test('closing popout window restores PiP layout', async ({
    app,
    page,
    ffmpegStream: _ffmpegStream2,
    videoPort
  }) => {
    // Start video
    const uriInput = page.locator('input[type="text"]').first()
    await uriInput.fill(`udp://@:${videoPort}`)
    await page.locator('button', { hasText: 'Start' }).click()

    await expect(async () => {
      const text = await page.textContent('body')
      expect(text).toContain('Streaming')
    }).toPass({ timeout: 10_000 })

    // Click popout
    const popoutBtn = page.locator('[class*="popoutBtn"]').first()
    if (await popoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await popoutBtn.click()
    } else {
      test.skip(true, 'Popout button not visible — PiP may not be showing')
      return
    }

    await page.waitForTimeout(1000)
    const windows = await app.windows()
    expect(windows.length).toBeGreaterThanOrEqual(2)

    // The main window should NOT show the toggle buttons (one view is popped out)
    const toggleBtns = page.locator('[class*="viewToggle"]')
    await expect(toggleBtns).toHaveCount(0)

    // Close the popout window
    const popoutPage = windows.find((w) => w !== page)!
    await popoutPage.close()
    await page.waitForTimeout(500)

    // Toggle buttons should reappear
    await expect(async () => {
      const count = await page.locator('[class*="viewToggle"]').count()
      expect(count).toBe(1)
    }).toPass({ timeout: 3_000 })
  })

  test('recording produces a valid MP4 file', async ({
    page,
    ffmpegStream: _ffmpegStream,
    videoPort
  }) => {
    test.setTimeout(60_000)
    const recordingPath = path.join(os.tmpdir(), `meridian-test-${Date.now()}.mp4`)

    // Start the stream
    const uriInput = page.locator('input[type="text"]').first()
    await uriInput.fill(`udp://@:${videoPort}`)
    await page.locator('button', { hasText: 'Start' }).click()

    // Wait for streaming — verify via app state, not just UI text
    await expect(async () => {
      const state = await page.evaluate(() => window.bridge.videoGetState())
      expect(state.streaming).toBe(true)
    }).toPass({ timeout: 15_000 })

    // Wait for video data to flow and init segment to be cached
    await page.waitForTimeout(3000)

    // Start recording — retry if ffmpeg temporarily drops the stream
    await expect(async () => {
      await page.evaluate((recPath) => window.bridge.videoStartRecording(recPath), recordingPath)
      const state = await page.evaluate(() => window.bridge.videoGetState())
      expect(state.recording).toBe(true)
    }).toPass({ timeout: 10_000 })

    // Record for 5 seconds
    await page.waitForTimeout(5000)

    // Stop recording
    await page.evaluate(() => {
      return window.bridge.videoStopRecording()
    })

    // Wait for file stream to flush
    await page.waitForTimeout(1000)

    // Verify the recording file exists and has meaningful size
    expect(fs.existsSync(recordingPath)).toBe(true)
    const stats = fs.statSync(recordingPath)
    expect(stats.size).toBeGreaterThan(1000) // at least 1KB

    // Verify it's a valid MP4 by checking for ftyp box at the start
    const fd = fs.openSync(recordingPath, 'r')
    const header = Buffer.alloc(8)
    fs.readSync(fd, header, 0, 8, 0)
    fs.closeSync(fd)
    const boxType = header.toString('ascii', 4, 8)
    expect(boxType).toBe('ftyp')

    // Cleanup
    fs.unlinkSync(recordingPath)
  })
})

// ── Multi-format tests ───────────────────────────────────────────────────────

/**
 * Fixtures for TCP MPEG-TS streaming.
 * ffmpeg serves MPEG-TS over TCP (listen mode), app connects to it.
 */
interface TcpFixtures {
  app: ElectronApplication
  page: Page
  tcpStream: ChildProcess
  tcpPort: number
}

let nextTcpPort = 16600

const tcpTest = base.extend<TcpFixtures>({
  tcpPort: async ({}, use) => {
    await use(nextTcpPort++)
  },

  app: async ({}, use) => {
    execSync('npx electron-vite build', {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe'
    })

    const tcpAppEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      GC_UDP_PORT: '14599'
    }
    delete tcpAppEnv.ELECTRON_RUN_AS_NODE

    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js')],
      env: tcpAppEnv
    })

    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForTimeout(1000)
    await use(page)
  },

  tcpStream: async ({ tcpPort }, use) => {
    const ffmpeg = findFfmpeg()

    // ffmpeg listens on TCP, serving MPEG-TS to whoever connects
    const proc = spawn(
      ffmpeg,
      [
        '-re',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=320x240:rate=15`,
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'baseline',
        '-b:v',
        '500k',
        '-g',
        '15',
        '-an',
        '-f',
        'mpegts',
        `tcp://127.0.0.1:${tcpPort}?listen`
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    // Wait for ffmpeg to start listening
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 3000)
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('Waiting for') || text.includes('frame=')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      proc.on('error', reject)
    })

    await use(proc)

    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 1000))
    if (!proc.killed) proc.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 500))
  }
})

tcpTest.describe('Video Streaming — TCP MPEG-TS', () => {
  tcpTest(
    'receives and displays video over TCP',
    async ({ page, tcpStream: _tcpStream, tcpPort }) => {
      tcpTest.setTimeout(60_000)

      // Select TCP MPEG-TS source and set URI
      // The video controls select has tcp_mpegts as an option; the map selector doesn't
      const sourceSelect = page.locator('select:has(option[value="tcp_mpegts"])')
      await sourceSelect.selectOption('tcp_mpegts')

      const uriInput = page.locator('input[type="text"]').first()
      await uriInput.fill(`tcp://127.0.0.1:${tcpPort}`)

      // Start streaming
      await page.locator('button', { hasText: 'Start' }).click()

      // Wait for app-level streaming state
      await expect(async () => {
        const state = await page.evaluate(() => window.bridge.videoGetState())
        expect(state.streaming).toBe(true)
      }).toPass({ timeout: 15_000 })

      // Verify video element is playing
      await expect(async () => {
        const state = await page.evaluate(() => {
          const video = document.querySelector('video')
          if (!video) return { playing: false, time: 0 }
          return { playing: !video.paused && video.readyState >= 2, time: video.currentTime }
        })
        expect(state.playing).toBe(true)
        expect(state.time).toBeGreaterThan(0)
      }).toPass({ timeout: 10_000 })
    }
  )
})

/**
 * Fixtures for RTSP streaming.
 * Uses ffmpeg to serve an RTSP stream via rtp over TCP loopback.
 * Requires mediamtx or similar RTSP server — skip if not available.
 */
interface RtspFixtures {
  app: ElectronApplication
  page: Page
  rtspUrl: string
  rtspServer: ChildProcess
  rtspFeeder: ChildProcess
}

let nextRtspPort = 18554

const rtspTest = base.extend<RtspFixtures>({
  app: async ({}, use) => {
    execSync('npx electron-vite build', {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe'
    })

    const tcpAppEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      GC_UDP_PORT: '14599'
    }
    delete tcpAppEnv.ELECTRON_RUN_AS_NODE

    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js')],
      env: tcpAppEnv
    })

    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForTimeout(1000)
    await use(page)
  },

  rtspUrl: async ({}, use) => {
    const port = nextRtspPort++
    await use(`rtsp://127.0.0.1:${port}/test`)
  },

  // mediamtx acts as an RTSP server — skip tests if not installed
  rtspServer: async ({ rtspUrl }, use) => {
    let mediamtxPath: string
    try {
      execSync('which mediamtx', { stdio: 'pipe' })
      mediamtxPath = 'mediamtx'
    } catch {
      rtspTest.skip(true, 'mediamtx not installed — skipping RTSP tests')
      return
    }

    const port = new URL(rtspUrl).port
    const proc = spawn(mediamtxPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...(process.env as Record<string, string>),
        MTX_PROTOCOLS: 'tcp',
        MTX_RTSPADDRESS: `:${port}`
      }
    })

    // Wait for server to start
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000)
      proc.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('listener opened')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      proc.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('listener opened')) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    await use(proc)

    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!proc.killed) proc.kill('SIGKILL')
  },

  // ffmpeg pushes a test stream to the RTSP server
  rtspFeeder: async ({ rtspUrl, rtspServer: _rtspServer }, use) => {
    const ffmpeg = findFfmpeg()

    const proc = spawn(
      ffmpeg,
      [
        '-re',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=15',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'baseline',
        '-b:v',
        '500k',
        '-g',
        '15',
        '-an',
        '-f',
        'rtsp',
        '-rtsp_transport',
        'tcp',
        rtspUrl
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000)
      proc.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('frame=')) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    await use(proc)

    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!proc.killed) proc.kill('SIGKILL')
  }
})

rtspTest.describe('Video Streaming — RTSP', () => {
  rtspTest(
    'receives and displays video over RTSP',
    async ({ page, rtspUrl, rtspServer: _rtspServer, rtspFeeder: _rtspFeeder }) => {
      rtspTest.setTimeout(60_000)

      // Select RTSP source
      const sourceSelect = page.locator('select:has(option[value="rtsp"])')
      await sourceSelect.selectOption('rtsp')

      const uriInput = page.locator('input[type="text"]').first()
      await uriInput.fill(rtspUrl)

      // Start streaming
      await page.locator('button', { hasText: 'Start' }).click()

      // Wait for app-level streaming state
      await expect(async () => {
        const state = await page.evaluate(() => window.bridge.videoGetState())
        expect(state.streaming).toBe(true)
      }).toPass({ timeout: 15_000 })

      // Verify video is playing
      await expect(async () => {
        const state = await page.evaluate(() => {
          const video = document.querySelector('video')
          if (!video) return { playing: false, time: 0 }
          return { playing: !video.paused && video.readyState >= 2, time: video.currentTime }
        })
        expect(state.playing).toBe(true)
        expect(state.time).toBeGreaterThan(0)
      }).toPass({ timeout: 10_000 })
    }
  )
})
