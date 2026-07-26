import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTilemapStore } from './tilemap'
import { MAP_W } from './assetIo'

/**
 * A map that has no name yet (user wish, 2026-07-25).
 *
 * "New" gives you a fresh screen to paint on, and — this is the point — it belongs to NO
 * file. Until "Save as…" gives it a name, nothing may be written anywhere: the old store
 * always held a default rel, so a Ctrl+S on a nameless map quietly created a file nobody
 * had asked for. That is the same family as the silent save that once cost a real level
 * (memory: breadcraft-ui-layering, breadcraft-asset-documents).
 */
describe('a map with no name yet', () => {
  const writes: string[] = []

  beforeEach(() => {
    setActivePinia(createPinia())
    writes.length = 0
    ;(globalThis as unknown as { window: unknown }).window = {
      breadcraft: {
        assets: {
          read: vi.fn(async () => null),
          write: vi.fn(async (_dir: string, _kind: string, rel: string) => {
            writes.push(rel)
          })
        }
      }
    }
  })

  it('"New" hands back one blank screen, bound to nothing', async () => {
    const tm = useTilemapStore()
    await tm.loadForProject('D:/proj', 'assets/level01.tilemap')
    tm.growTo(MAP_W * 3)
    tm.setTile(41, 2, 130, 5)

    tm.newBlank('D:/proj')

    expect(tm.width).toBe(MAP_W) // back to one screen, not the old level's width
    expect(tm.bound).toBe(false)
    expect(tm.currentRel()).toBe('')
    expect(tm.dirty).toBe(false) // an untouched blank map has nothing to save
    expect(writes).toEqual([]) // and creating it wrote nothing at all
  })

  it('saving a nameless map writes NOTHING (Ctrl+S walks past a grey button)', async () => {
    const tm = useTilemapStore()
    tm.newBlank('D:/proj')
    tm.setTile(1, 1, 66, 5)
    expect(tm.dirty).toBe(true)

    await tm.save()

    expect(writes).toEqual([])
    expect(tm.dirty).toBe(true) // still unsaved, and honest about it
  })

  it('"Save as…" is what gives it a name — and then Save works as usual', async () => {
    const tm = useTilemapStore()
    tm.newBlank('D:/proj')
    tm.setTile(1, 1, 66, 5)

    await tm.saveTo('D:/proj', 'assets/level02.tilemap')

    expect(tm.bound).toBe(true)
    expect(tm.currentRel()).toBe('assets/level02.tilemap')
    expect(tm.dirty).toBe(false)

    tm.setTile(2, 2, 67, 5)
    await tm.save()
    expect(writes).toEqual(['assets/level02.tilemap', 'assets/level02.tilemap'])
  })

  it('a project without a map opens nameless — no default file is invented', async () => {
    const tm = useTilemapStore()
    await tm.loadForProject('D:/proj', null)

    expect(tm.bound).toBe(false)
    tm.setTile(0, 0, 65, 5)
    await tm.save()
    expect(writes).toEqual([])
  })

  it('opening a real map binds it again', async () => {
    const tm = useTilemapStore()
    tm.newBlank('D:/proj')
    await tm.switchAsset('D:/proj', 'assets/level01.tilemap')

    expect(tm.bound).toBe(true)
    expect(tm.currentRel()).toBe('assets/level01.tilemap')
  })
})
