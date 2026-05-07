#!/usr/bin/env node

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const packageJson = require(path.join(repoRoot, 'package.json'))
const platform = process.platform
const arch = process.arch
const bundleName = `meridian-server-${packageJson.version}-${platform}-${arch}`
const distDir = path.join(repoRoot, 'dist')
const bundleDir = path.join(distDir, bundleName)
const appDir = path.join(bundleDir, 'app')
const binDir = path.join(bundleDir, 'bin')

function requirePath(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`)
  }
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true })
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8')
  if (platform !== 'win32') {
    fs.chmodSync(filePath, 0o755)
  }
}

function nodeBinaryName() {
  return platform === 'win32' ? 'node.exe' : 'node'
}

function copyNodeRuntime() {
  const src = process.execPath
  const dest = path.join(binDir, nodeBinaryName())
  fs.mkdirSync(binDir, { recursive: true })
  fs.copyFileSync(src, dest)
  if (platform !== 'win32') {
    fs.chmodSync(dest, 0o755)
  }
}

function writeLaunchers() {
  writeExecutable(
    path.join(bundleDir, 'meridian-server'),
    `#!/usr/bin/env sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export NODE_ENV=production
export MERIDIAN_STATIC_DIR="\${MERIDIAN_STATIC_DIR:-$DIR/app/renderer}"
exec "$DIR/bin/node" "$DIR/app/main/server.js" "$@"
`
  )

  fs.writeFileSync(
    path.join(bundleDir, 'meridian-server.cmd'),
    `@echo off\r
setlocal\r
set "DIR=%~dp0"\r
set "NODE_ENV=production"\r
if "%MERIDIAN_STATIC_DIR%"=="" set "MERIDIAN_STATIC_DIR=%DIR%app\\renderer"\r
"%DIR%bin\\node.exe" "%DIR%app\\main\\server.js" %*\r
`,
    'utf8'
  )
}

function writeBundlePackageJson() {
  const serverPackage = {
    name: 'meridian-server-bundle',
    version: packageJson.version,
    private: true,
    type: 'commonjs',
    dependencies: packageJson.dependencies
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(serverPackage, null, 2))
}

function npmCliPath() {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && fs.existsSync(npmExecPath)) return npmExecPath

  try {
    return require.resolve('npm/bin/npm-cli.js')
  } catch {
    return null
  }
}

function installProductionDependencies() {
  const args = ['install', '--omit=dev', '--no-audit', '--no-fund']
  const npmCli = npmCliPath()
  const command = npmCli ? process.execPath : platform === 'win32' ? 'npm.cmd' : 'npm'
  const commandArgs = npmCli ? [npmCli, ...args] : args

  execFileSync(command, commandArgs, {
    cwd: appDir,
    stdio: 'inherit',
    shell: platform === 'win32' && !npmCli,
    env: {
      ...process.env,
      npm_config_update_notifier: 'false'
    }
  })
}

function zipBundle() {
  const zipPath = path.join(distDir, `${bundleName}.zip`)
  fs.rmSync(zipPath, { force: true })

  if (platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${bundleName}' -DestinationPath '${path.basename(zipPath)}' -Force`
      ],
      { cwd: distDir, stdio: 'inherit' }
    )
  } else {
    execFileSync('zip', ['-qry', path.basename(zipPath), bundleName], {
      cwd: distDir,
      stdio: 'inherit'
    })
  }

  return zipPath
}

function main() {
  const outMain = path.join(repoRoot, 'out', 'main')
  const outRenderer = path.join(repoRoot, 'out', 'renderer')
  requirePath(path.join(outMain, 'server.js'), 'Built server entry')
  requirePath(outRenderer, 'Built renderer directory')

  fs.rmSync(bundleDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  fs.mkdirSync(distDir, { recursive: true })

  copyDir(outMain, path.join(appDir, 'main'))
  copyDir(outRenderer, path.join(appDir, 'renderer'))
  copyNodeRuntime()
  writeBundlePackageJson()
  installProductionDependencies()
  writeLaunchers()

  fs.writeFileSync(
    path.join(bundleDir, 'README.txt'),
    [
      'Meridian Server',
      '',
      'Run:',
      platform === 'win32' ? '  meridian-server.cmd' : '  ./meridian-server',
      '',
      'Useful environment variables:',
      '  MERIDIAN_SERVER_HOST=127.0.0.1',
      '  MERIDIAN_SERVER_PORT=8080',
      '  MERIDIAN_SERVER_TOKEN=change-me',
      '  MERIDIAN_SERVER_READONLY_TOKEN=observer-token',
      '  GC_UDP_PORT=14550',
      '  GC_TCP_LINKS=127.0.0.1:5760',
      '',
      'Open browser clients at http://HOST:PORT/?token=TOKEN',
      ''
    ].join(os.EOL),
    'utf8'
  )

  const zipPath = zipBundle()
  console.log(`Created ${zipPath}`)
}

main()
