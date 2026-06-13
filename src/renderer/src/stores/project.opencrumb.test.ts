import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjectStore } from './project'

// Befund 7 (EISEN M4.T1): opening a `.crumb` from the file tree that isn't in the
// manifest must LOAD it from disk first — never open an empty buffer that the next
// Ctrl+S would write back over the real file. Opening must NOT mutate `.bread`.

function stubRead(read: (dir: string, rel: string) => Promise<string | null>): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    breadcraft: { assets: { read } }
  }
}

describe('project store: openCrumb (Befund 7)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('reads an unmanifested crumb from disk, then opens it as the active tab', async () => {
    const read = vi.fn().mockResolvedValue('Print "hi"')
    stubRead(read)
    const p = useProjectStore()
    p.dir = '/proj'

    await p.openCrumb('extra/loose.crumb')

    expect(read).toHaveBeenCalledWith('/proj', 'extra/loose.crumb')
    expect(p.contents['extra/loose.crumb']).toBe('Print "hi"')
    expect(p.dirty['extra/loose.crumb']).toBe(false) // loaded, not edited
    expect(p.activeRel).toBe('extra/loose.crumb')
    expect(p.openFiles).toContain('extra/loose.crumb')
  })

  it('does NOT re-read (and clobber unsaved edits of) an already-open crumb', async () => {
    const read = vi.fn().mockResolvedValue('FROM DISK')
    stubRead(read)
    const p = useProjectStore()
    p.dir = '/proj'
    p.contents['main.crumb'] = 'EDITED'
    p.dirty['main.crumb'] = true

    await p.openCrumb('main.crumb')

    expect(read).not.toHaveBeenCalled()
    expect(p.contents['main.crumb']).toBe('EDITED')
    expect(p.dirty['main.crumb']).toBe(true)
    expect(p.activeRel).toBe('main.crumb')
  })

  it('throws when the file vanished (null read) instead of opening an empty savable tab', async () => {
    const read = vi.fn().mockResolvedValue(null)
    stubRead(read)
    const p = useProjectStore()
    p.dir = '/proj'

    await expect(p.openCrumb('gone.crumb')).rejects.toThrow(/nicht gefunden/)
    expect(p.openFiles).not.toContain('gone.crumb')
    expect(p.contents['gone.crumb']).toBeUndefined()
    expect(p.activeRel).not.toBe('gone.crumb')
  })
})
