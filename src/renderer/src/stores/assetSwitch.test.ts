import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTilemapStore } from './tilemap'

/**
 * Leaving an editor must never write the file behind the user's back (user, 2026-07-25).
 *
 * `switchAsset` used to save any pending edit into the file the user was LEAVING. With
 * "empty the map" one click away, that turned into real damage: a level was emptied and
 * the switch wrote the empty map over it. It also contradicts the one rule the asset
 * editors rest on — saving is EXPLICIT (ASSET_DOCUMENTS.md §2.5).
 *
 * These tests pin the store half of the fix: switching and creating write NOTHING to the
 * file being left. Asking the user whether to discard is the project store's job.
 */
describe('leaving an editor with unsaved work', () => {
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

  it('switching to another map does not save the one being left', async () => {
    const tm = useTilemapStore()
    await tm.loadForProject('D:/proj', 'assets/level01.tilemap')
    tm.setTile(2, 2, 130, 5)
    expect(tm.dirty).toBe(true)

    await tm.switchAsset('D:/proj', 'assets/level02.tilemap')

    expect(writes).toEqual([]) // level01 on disk is untouched
    expect(tm.currentRel()).toBe('assets/level02.tilemap')
  })

  it('creating a new map does not save the one being left', async () => {
    const tm = useTilemapStore()
    await tm.loadForProject('D:/proj', 'assets/level01.tilemap')
    tm.clear() // the destructive click that made this dangerous
    expect(tm.dirty).toBe(true)

    await tm.createBlank('D:/proj', 'assets/level02.tilemap')

    // Exactly one write, and it is the NEW file — never the one we came from.
    expect(writes).toEqual(['assets/level02.tilemap'])
  })

  it('an explicit save still writes, of course', async () => {
    const tm = useTilemapStore()
    await tm.loadForProject('D:/proj', 'assets/level01.tilemap')
    tm.setTile(1, 1, 66, 5)

    await tm.save()

    expect(writes).toEqual(['assets/level01.tilemap'])
    expect(tm.dirty).toBe(false)
  })
})
