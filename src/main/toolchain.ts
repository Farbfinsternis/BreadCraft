import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// Locating the BUNDLED cc65 toolchain (zlib-licensed, shipped inside the app —
// see memory: breadcraft-cc65-bundling). cc65 lives in `resources/cc65/` in the
// repo. In dev the app runs from the project, so resources sit next to the source
// tree; when packaged, electron-builder copies `resources/` into the app's
// resources dir (process.resourcesPath) via "extraResources". This helper hides
// that difference so the rest of main just asks for `cl65`.

/** Absolute path to the bundled cc65 root (the folder holding bin/ lib/ …). */
export function cc65Root(): string {
  if (app.isPackaged) {
    // extraResources places our resources/cc65 at <resourcesPath>/cc65.
    return join(process.resourcesPath, 'cc65')
  }
  // Dev: __dirname is out/main; the project root is two levels up.
  return join(app.getAppPath(), 'resources', 'cc65')
}

const EXE = process.platform === 'win32' ? '.exe' : ''

/** Absolute path to a cc65 tool by base name, e.g. tool('cl65'). */
export function cc65Tool(name: string): string {
  return join(cc65Root(), 'bin', name + EXE)
}

/** True if the bundled cl65 driver is present where we expect it. */
export function cc65Available(): boolean {
  return existsSync(cc65Tool('cl65'))
}
