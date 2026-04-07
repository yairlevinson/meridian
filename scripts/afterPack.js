// electron-builder afterPack hook
// Re-signs all native modules, frameworks, and dylibs with ad-hoc identity
// so macOS Sequoia doesn't reject the app for "different Team IDs".

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

function findFilesDeep(dir, extensions) {
  const results = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      results.push(...findFilesDeep(full, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full)
    }
  }
  return results
}

function findBundles(dir, ext) {
  const results = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (entry.name.endsWith(ext)) {
        results.push(full)
      } else {
        results.push(...findBundles(full, ext))
      }
    }
  }
  return results
}

function sign(filePath, entitlements) {
  const args = ['--force', '--sign', '-', '--timestamp=none']
  if (entitlements) {
    args.push('--entitlements', entitlements)
  }
  args.push(filePath)
  try {
    execFileSync('codesign', args, { stdio: 'pipe' })
  } catch (e) {
    console.warn(
      `  ⚠ Failed to sign ${path.basename(filePath)}: ${e.stderr?.toString().trim() || e.message}`
    )
  }
}

function removeNonDarwinPrebuilds(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'prebuilds') {
        for (const platform of fs.readdirSync(full, { withFileTypes: true })) {
          if (platform.isDirectory() && !platform.name.startsWith('darwin')) {
            console.log(`  Removing foreign prebuild: ${platform.name}`)
            fs.rmSync(path.join(full, platform.name), { recursive: true, force: true })
          }
        }
      } else {
        removeNonDarwinPrebuilds(full)
      }
    }
  }
}

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return

  const appDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const contentsDir = path.join(appDir, 'Contents')
  const frameworksDir = path.join(contentsDir, 'Frameworks')
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist')

  console.log('afterPack: re-signing native modules and frameworks...')

  // 1. Remove foreign-platform prebuilds from unpacked serialport
  const unpackedSp = path.join(
    contentsDir,
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    '@serialport'
  )
  removeNonDarwinPrebuilds(unpackedSp)

  // 2. Sign all individual native binaries (.node, .dylib, .so) in the entire bundle
  //    Must be done before signing the bundles that contain them
  const nativeFiles = findFilesDeep(contentsDir, ['.node', '.dylib', '.so'])
  for (const f of nativeFiles) {
    console.log(`  Signing: ${path.relative(appDir, f)}`)
    sign(f, entitlements)
  }

  // 3. Sign .framework bundles (these contain already-signed dylibs)
  const frameworks = findBundles(frameworksDir, '.framework')
  for (const fw of frameworks) {
    console.log(`  Signing framework: ${path.basename(fw)}`)
    sign(fw, entitlements)
  }

  // 4. Sign helper .app bundles inside Frameworks
  const helpers = findBundles(frameworksDir, '.app')
  for (const helper of helpers) {
    console.log(`  Signing helper: ${path.basename(helper)}`)
    sign(helper, entitlements)
  }

  // 5. Sign the main executable
  const macOsDir = path.join(contentsDir, 'MacOS')
  if (fs.existsSync(macOsDir)) {
    for (const entry of fs.readdirSync(macOsDir)) {
      const full = path.join(macOsDir, entry)
      if (!fs.statSync(full).isDirectory()) {
        console.log(`  Signing main binary: ${entry}`)
        sign(full, entitlements)
      }
    }
  }

  // 6. Sign the outer .app bundle
  console.log(`  Signing app bundle: ${path.basename(appDir)}`)
  sign(appDir, entitlements)

  console.log('afterPack: signing complete.')
}
