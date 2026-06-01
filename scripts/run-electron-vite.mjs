// Launcher for electron-vite that strips ELECTRON_RUN_AS_NODE from the child's
// environment. That variable forces Electron to run as plain Node (so
// `require('electron').app` is undefined and the app crashes on launch). It may
// be set globally on this machine because BASSM relies on it — so we must NOT
// clear it system-wide, only for this process tree.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

const subcommand = process.argv[2] // 'dev' | 'build' | 'preview'
if (!subcommand) {
  console.error('Usage: node scripts/run-electron-vite.mjs <dev|build|preview>')
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Resolve the electron-vite CLI relative to its package.json — the bin subpath
// isn't exposed via "exports", so we can't require.resolve it directly.
const pkgDir = dirname(require.resolve('electron-vite/package.json'))
const cli = join(pkgDir, require('electron-vite/package.json').bin['electron-vite'])

const child = spawn(process.execPath, [cli, subcommand], {
  stdio: 'inherit',
  env
})

child.on('exit', (code) => process.exit(code ?? 0))
