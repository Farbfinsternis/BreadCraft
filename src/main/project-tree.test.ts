import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readProjectTree, createFolder } from './project'

// readProjectTree / createFolder are plain FS ops — test against a real temp dir.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bc-tree-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readProjectTree (P2.T0b)', () => {
  it('reads files + folders recursively, dirs first then files, alphabetical', () => {
    writeFileSync(join(dir, 'main.crumb'), 'x')
    mkdirSync(join(dir, 'assets', 'sprites'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'sprites', 'player.sprite'), 'x')
    writeFileSync(join(dir, 'zebra.tilemap'), 'x')

    const tree = readProjectTree(dir)
    // top level: 'assets' (dir) before files; 'main.crumb' before 'zebra.tilemap'
    expect(tree.map((n) => n.name)).toEqual(['assets', 'main.crumb', 'zebra.tilemap'])
    expect(tree[0].kind).toBe('dir')

    const assets = tree[0]
    expect(assets.children?.[0].name).toBe('sprites')
    expect(assets.children?.[0].kind).toBe('dir')
    const sprites = assets.children?.[0]
    expect(sprites?.children?.[0]).toMatchObject({
      name: 'player.sprite',
      rel: 'assets/sprites/player.sprite',
      kind: 'file'
    })
  })

  it('hides build/, .git, and the .bread metafile', () => {
    writeFileSync(join(dir, 'game.bread'), '{}')
    writeFileSync(join(dir, 'main.crumb'), 'x')
    mkdirSync(join(dir, 'build'))
    writeFileSync(join(dir, 'build', 'main.prg'), 'x')
    mkdirSync(join(dir, '.git'))

    const names = readProjectTree(dir).map((n) => n.name)
    expect(names).toEqual(['main.crumb'])
  })

  it('uses forward slashes in rel even for nested paths', () => {
    mkdirSync(join(dir, 'levels'))
    writeFileSync(join(dir, 'levels', 'cave.tilemap'), 'x')
    const tree = readProjectTree(dir)
    expect(tree[0].children?.[0].rel).toBe('levels/cave.tilemap')
  })

  it('returns [] for a missing directory', () => {
    expect(readProjectTree(join(dir, 'nope'))).toEqual([])
  })
})

describe('createFolder (P2.T0b)', () => {
  it('creates a nested folder and returns the normalised rel', () => {
    const rel = createFolder(dir, 'assets/sprites')
    expect(rel).toBe('assets/sprites')
    const tree = readProjectTree(dir)
    expect(tree[0].name).toBe('assets')
    expect(tree[0].children?.[0].name).toBe('sprites')
  })

  it('is idempotent (creating an existing folder is fine)', () => {
    createFolder(dir, 'a/b')
    expect(() => createFolder(dir, 'a/b')).not.toThrow()
  })

  it('normalises backslashes + trims slashes', () => {
    const rel = createFolder(dir, '\\tilesets\\')
    expect(rel).toBe('tilesets')
  })

  it('throws on an empty name', () => {
    expect(() => createFolder(dir, '   ')).toThrowError(/Ordnername fehlt/)
  })
})
