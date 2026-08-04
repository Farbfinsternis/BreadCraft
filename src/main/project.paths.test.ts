import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, sep } from 'path'
import { tmpdir } from 'os'
import { resolveInside, saveFile, writeAsset, readAsset, createFolder } from './project'

// ===========================================================================================
//  The project folder is a wall (Review #1, B-12)
//
//  Every path the main process writes to arrives over IPC as a plain string from the
//  renderer, or out of a `.bread` file on disk. `../../.bashrc` is a perfectly ordinary
//  relative path, and `join` resolves it without a murmur — so before this, a bug in the
//  renderer or a hand-edited project file could write outside the folder the user believes
//  they are working in.
//
//  Nothing in BreadCraft sends such a path today. That is exactly why it is worth closing
//  now: the answer to "does anything legitimate break?" is still no.
// ===========================================================================================

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bc-paths-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveInside: which paths belong to the project', () => {
  it('lets an ordinary project path through, absolute and resolved', () => {
    expect(resolveInside(dir, 'crumbs/physics.crumb')).toBe(resolve(dir, 'crumbs/physics.crumb'))
  })

  it('accepts a `..` that stays inside — the rule is where you LAND, not what you wrote', () => {
    // `assets/../crumbs/x` is a silly way to say `crumbs/x`, but it is not an escape, and a
    // check that banned the two characters outright would reject it.
    expect(resolveInside(dir, 'assets/../crumbs/x.crumb')).toBe(resolve(dir, 'crumbs/x.crumb'))
  })

  it('accepts the project directory itself', () => {
    expect(resolveInside(dir, '.')).toBe(resolve(dir))
  })

  it('refuses a path that climbs out', () => {
    expect(() => resolveInside(dir, '../evil.crumb')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, 'a/../../evil.crumb')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, '../../../../../../etc/passwd')).toThrow(
      /innerhalb des Projekts/
    )
  })

  it('★ refuses a SIBLING whose name merely starts the same way', () => {
    // The classic hole, and the reason the check compares against `dir + separator`: for a
    // project at …/held, the path ../heldenreise/x resolves to …/heldenreise/x, which starts
    // with the string …/held — a naive prefix test waves it through, into a DIFFERENT project.
    const held = join(dir, 'held')
    mkdirSync(held, { recursive: true })
    const escaped = resolve(dir, 'heldenreise/x.crumb')
    expect(escaped.startsWith(resolve(held))).toBe(true) // the trap is real…
    expect(escaped.startsWith(resolve(held) + sep)).toBe(false) // …and this is what closes it
    expect(() => resolveInside(held, '../heldenreise/x.crumb')).toThrow(/innerhalb des Projekts/)
  })

  it('refuses an absolute path — POSIX, Windows drive and UNC alike', () => {
    // `resolve` would silently DROP the project dir for any of these, which is the whole danger.
    expect(() => resolveInside(dir, '/etc/passwd')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, 'C:/Windows/system32/x')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, 'C:\\Windows\\x')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, '//server/share/x')).toThrow(/innerhalb des Projekts/)
    expect(() => resolveInside(dir, '\\\\server\\share\\x')).toThrow(/innerhalb des Projekts/)
  })

  it('reads a backslash path as a path, not as an escape hatch', () => {
    expect(resolveInside(dir, 'crumbs\\physics.crumb')).toBe(resolve(dir, 'crumbs/physics.crumb'))
    expect(() => resolveInside(dir, '..\\evil.crumb')).toThrow(/innerhalb des Projekts/)
  })

  it('refuses an empty path instead of silently meaning the project folder', () => {
    expect(() => resolveInside(dir, '')).toThrow(/Pfad fehlt/)
    expect(() => resolveInside(dir, '   ')).toThrow(/Pfad fehlt/)
  })
})

describe('the write paths use it — nothing lands outside the project', () => {
  // One test per IPC-reachable writer: the helper existing is not the point, being CALLED is.
  it('saveFile', () => {
    expect(() => saveFile(dir, '../escaped.crumb', 'x')).toThrow(/innerhalb des Projekts/)
    expect(existsSync(join(dir, '..', 'escaped.crumb'))).toBe(false)
    saveFile(dir, 'crumbs/ok.crumb', 'x') // and the ordinary case still works
    expect(existsSync(join(dir, 'crumbs/ok.crumb'))).toBe(true)
  })

  it('writeAsset', () => {
    expect(() => writeAsset(dir, 'palette', '../escaped.palette', '{}')).toThrow(
      /innerhalb des Projekts/
    )
    expect(existsSync(join(dir, '..', 'escaped.palette'))).toBe(false)
  })

  it('createFolder', () => {
    expect(() => createFolder(dir, '../escaped-folder')).toThrow(/innerhalb des Projekts/)
    expect(existsSync(join(dir, '..', 'escaped-folder'))).toBe(false)
  })

  it('readAsset — reading out of the project is a leak too', () => {
    expect(() => readAsset(dir, '../../../../etc/passwd')).toThrow(/innerhalb des Projekts/)
  })
})
