import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import type { WebContents } from 'electron'
import { viceManagedDir, findViceRecursive } from './settings'
import { writeConfig } from './config'
import type { ViceDownloadProgress, ViceDownloadResult } from '../shared/ipc'

/**
 * In-app VICE download (T3): fetch a *pinned* VICE build, verify its SHA-256, extract
 * it into the app-managed folder, locate x64sc and remember it — so a stranger gets a
 * runnable emulator in one click, without hunting SourceForge.
 *
 * The pin below is nailed down deliberately and MUST be re-verified whenever it is
 * bumped: download the file, recompute the hash, update all three fields together.
 * The hash is the safety line — if the download is corrupted, truncated, or a mirror
 * hands us an HTML interstitial instead of the zip, the mismatch aborts before we ever
 * run anything (VICE_ONBOARDING_PLAN T3; memory: breadcraft-cc65-bundling — VICE is not
 * bundled, GPL, fetched at runtime instead).
 */
export const VICE_PIN = {
  version: '3.10',
  url: 'https://sourceforge.net/projects/vice-emu/files/releases/binaries/windows/GTK3VICE-3.10-win64.zip/download',
  sha256: 'beb3791d90e98f7e012c0028f26fbaa6545c8fce676f852a67f8ad893dee9d08'
} as const

/** Unpack a .zip with Windows' built-in PowerShell (no dependency; Windows-only scope). */
function extractZip(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`
      ],
      { windowsHide: true }
    )
    let err = ''
    ps.stderr.on('data', (d) => (err += String(d)))
    ps.on('error', reject)
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `exit ${code}`))))
  })
}

/**
 * Download → verify → extract → locate → persist. Progress is pushed to the renderer
 * on `vice:progress`; the final outcome is returned. Any failure (offline, bad
 * checksum, extraction error) resolves as `{ ok:false, error }` — never throws, never
 * runs an unverified binary — so the onboarding can offer a friendly fallback.
 */
export async function downloadAndInstallVice(wc: WebContents): Promise<ViceDownloadResult> {
  const managed = viceManagedDir()
  if (!managed) return { ok: false, error: 'no-userdata' }

  const send = (p: ViceDownloadProgress): void => {
    if (!wc.isDestroyed()) wc.send('vice:progress', p)
  }
  const tmpZip = join(tmpdir(), `breadcraft-vice-${Date.now()}.zip`)

  try {
    // 1) Stream the download, hashing as we go, reporting percent when size is known.
    send({ phase: 'downloading', percent: 0 })
    const res = await fetch(VICE_PIN.url, {
      redirect: 'follow',
      // Ask for the raw bytes — no transparent gzip/deflate. Electron's main-process fetch
      // otherwise decompresses the response, so the bytes we hash wouldn't match the zip on
      // the server and the checksum would fail even on a perfectly good download.
      headers: { 'User-Agent': 'BreadCraft', 'Accept-Encoding': 'identity' }
    })
    if (!res.ok || !res.body) throw new Error(`http-${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    const out = createWriteStream(tmpZip)
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      out.write(Buffer.from(value))
      received += value.length
      if (total) send({ phase: 'downloading', percent: Math.min(100, Math.round((received / total) * 100)) })
    }
    out.end()
    await new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve())
      out.on('error', reject)
    })

    // 2) Verify the checksum BEFORE anything is unpacked or run.
    send({ phase: 'verifying' })
    if (hash.digest('hex') !== VICE_PIN.sha256) throw new Error('checksum')

    // 3) Extract into a clean managed folder.
    send({ phase: 'extracting' })
    rmSync(managed, { recursive: true, force: true })
    mkdirSync(managed, { recursive: true })
    await extractZip(tmpZip, managed)

    // 4) Locate the emulator in the extracted tree and remember it.
    const exe = findViceRecursive(managed)
    if (!exe) throw new Error('no-exe')
    writeConfig({ vicePath: exe })
    return { ok: true, path: exe }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) }
  } finally {
    if (existsSync(tmpZip)) {
      try {
        rmSync(tmpZip, { force: true })
      } catch {
        // best-effort temp cleanup
      }
    }
  }
}
