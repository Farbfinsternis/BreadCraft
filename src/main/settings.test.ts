import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findViceExecutable, resolveViceFrom, findViceRecursive } from './settings'
import { VICE_PIN } from './vice-download'

// The newbie-facing promise (T4/T5): the user picks a FOLDER and BreadCraft locates
// the VICE binary inside it. These lock the folder layouts that must resolve — and the
// x64sc-over-x64 preference — so a stranger never has to hunt for `x64sc.exe`.
describe('findViceExecutable', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vice-test-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const touch = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), '')
  }

  it('finds x64sc.exe directly in the chosen folder', () => {
    touch(root, 'x64sc.exe')
    expect(findViceExecutable(root)).toBe(join(root, 'x64sc.exe'))
  })

  it('finds x64sc.exe in the bin/ subfolder (VICE Windows layout)', () => {
    touch(join(root, 'bin'), 'x64sc.exe')
    expect(findViceExecutable(root)).toBe(join(root, 'bin', 'x64sc.exe'))
  })

  it('finds x64sc.exe in any immediate subfolder', () => {
    touch(join(root, 'GTK3VICE-3.8'), 'x64sc.exe')
    expect(findViceExecutable(root)).toBe(join(root, 'GTK3VICE-3.8', 'x64sc.exe'))
  })

  it('prefers x64sc over the legacy x64, even across folders', () => {
    touch(root, 'x64.exe') // legacy core in the root
    touch(join(root, 'bin'), 'x64sc.exe') // accurate core deeper
    expect(findViceExecutable(root)).toBe(join(root, 'bin', 'x64sc.exe'))
  })

  it('falls back to x64.exe when no x64sc is present', () => {
    touch(join(root, 'bin'), 'x64.exe')
    expect(findViceExecutable(root)).toBe(join(root, 'bin', 'x64.exe'))
  })

  it('returns null when the folder holds no VICE binary', () => {
    touch(root, 'notepad.exe')
    expect(findViceExecutable(root)).toBeNull()
  })

  it('returns null for a non-existent folder without throwing', () => {
    expect(findViceExecutable(join(root, 'does-not-exist'))).toBeNull()
  })
})

// Auto-detection (T1) resolves the first VICE from PATH-style dirs (binary sits
// directly inside) then install dirs (scanned incl. bin/ + subfolders), in that order.
describe('resolveViceFrom', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vice-detect-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const touch = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), '')
  }

  it('finds a binary sitting directly on a PATH dir', () => {
    const pdir = join(root, 'onpath')
    touch(pdir, 'x64sc.exe')
    expect(resolveViceFrom([pdir], [])).toBe(join(pdir, 'x64sc.exe'))
  })

  it('does NOT dig into subfolders of a PATH dir (PATH means the exe is right there)', () => {
    const pdir = join(root, 'onpath')
    touch(join(pdir, 'bin'), 'x64sc.exe') // one level down — not on PATH itself
    expect(resolveViceFrom([pdir], [])).toBeNull()
  })

  it('scans install dirs incl. bin/ when PATH has nothing', () => {
    const install = join(root, 'Program Files', 'VICE')
    touch(join(install, 'bin'), 'x64sc.exe')
    expect(resolveViceFrom([], [install])).toBe(join(install, 'bin', 'x64sc.exe'))
  })

  it('prefers PATH over install dirs', () => {
    const pdir = join(root, 'onpath')
    const install = join(root, 'install')
    touch(pdir, 'x64sc.exe')
    touch(join(install, 'bin'), 'x64sc.exe')
    expect(resolveViceFrom([pdir], [install])).toBe(join(pdir, 'x64sc.exe'))
  })

  it('returns null when nothing on PATH or in install dirs has VICE', () => {
    const pdir = join(root, 'onpath')
    touch(pdir, 'other.exe')
    expect(resolveViceFrom([pdir], [join(root, 'nope')])).toBeNull()
  })
})

// After the download extracts, x64sc sits a couple of folders deep
// (GTK3VICE-<v>-win64/bin/x64sc.exe) — findViceRecursive must reach it (T3).
describe('findViceRecursive', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vice-rec-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const touch = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), '')
  }

  it('finds x64sc.exe two folders deep (the extracted VICE layout)', () => {
    const bin = join(root, 'GTK3VICE-3.10-win64', 'bin')
    touch(bin, 'x64sc.exe')
    expect(findViceRecursive(root)).toBe(join(bin, 'x64sc.exe'))
  })

  it('prefers x64sc over x64 anywhere in the tree', () => {
    touch(join(root, 'a'), 'x64.exe')
    touch(join(root, 'b', 'bin'), 'x64sc.exe')
    expect(findViceRecursive(root)).toBe(join(root, 'b', 'bin', 'x64sc.exe'))
  })

  it('respects the depth bound', () => {
    touch(join(root, 'a', 'b', 'c', 'd', 'e', 'f'), 'x64sc.exe')
    expect(findViceRecursive(root, 2)).toBeNull()
  })

  it('returns null for a tree with no VICE binary', () => {
    touch(join(root, 'x'), 'readme.txt')
    expect(findViceRecursive(root)).toBeNull()
  })
})

// The pinned VICE build (T3): guard the shape so a careless bump can't ship a
// malformed pin. Values themselves are re-verified by hand when bumped.
describe('VICE_PIN', () => {
  it('has a semver-ish version, an https URL and a 64-hex-char SHA-256', () => {
    expect(VICE_PIN.version).toMatch(/^\d+\.\d+/)
    expect(VICE_PIN.url).toMatch(/^https:\/\//)
    expect(VICE_PIN.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
