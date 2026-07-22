// Regenerates build/icon.png — the app + installer icon — from the tracked
// BreadCraft logo, dependency-free (Node's built-in zlib only). Crops the
// central arc-blue gear core into a square. Run: node scripts/make-icon.mjs
//
// build/icon.png is committed (see .gitignore exception) so packaging works on
// a clean checkout without running this. Re-run only if the source logo or the
// desired crop changes.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import zlib from 'node:zlib'

const root = path.resolve(url.fileURLToPath(new URL('..', import.meta.url)))
const SRC = path.join(root, 'src/renderer/src/assets/breadcraft-logo.png')
const OUT = path.join(root, 'build/icon.png')

// Square crop window in native source pixels (746x589 logo): the gear core.
const CROP_X = 182
const CROP_Y = 2
const CROP_S = 372

const buf = fs.readFileSync(SRC)

// --- parse PNG chunks (expects 8-bit RGBA, color type 6) ---
let off = 8
let W = 0, H = 0
const idat = []
while (off < buf.length) {
  const len = buf.readUInt32BE(off)
  const type = buf.toString('ascii', off + 4, off + 8)
  const data = buf.subarray(off + 8, off + 8 + len)
  if (type === 'IHDR') {
    W = data.readUInt32BE(0); H = data.readUInt32BE(4)
    if (data[8] !== 8 || data[9] !== 6) throw new Error('expected 8-bit RGBA source')
  } else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
  off += 12 + len
}

const bpp = 4
const raw = zlib.inflateSync(Buffer.concat(idat))
const stride = W * bpp

// --- unfilter scanlines into a flat RGBA buffer ---
const px = Buffer.alloc(H * stride)
let p = 0
for (let y = 0; y < H; y++) {
  const filter = raw[p++]
  const rowStart = y * stride
  for (let x = 0; x < stride; x++) {
    const rawByte = raw[p++]
    const a = x >= bpp ? px[rowStart + x - bpp] : 0
    const b = y > 0 ? px[rowStart - stride + x] : 0
    const c = x >= bpp && y > 0 ? px[rowStart - stride + x - bpp] : 0
    let val
    switch (filter) {
      case 0: val = rawByte; break
      case 1: val = rawByte + a; break
      case 2: val = rawByte + b; break
      case 3: val = rawByte + ((a + b) >> 1); break
      case 4: {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        val = rawByte + pr; break
      }
      default: throw new Error('bad filter ' + filter)
    }
    px[rowStart + x] = val & 0xff
  }
}

// --- crop the square region (filter None per row) ---
const S = CROP_S
const cropRaw = Buffer.alloc(S * (S * bpp + 1))
let q = 0
for (let y = 0; y < S; y++) {
  cropRaw[q++] = 0
  const sy = CROP_Y + y
  for (let x = 0; x < S; x++) {
    const src = ((sy * W) + (CROP_X + x)) * bpp
    cropRaw[q++] = px[src]
    cropRaw[q++] = px[src + 1]
    cropRaw[q++] = px[src + 2]
    cropRaw[q++] = px[src + 3]
  }
}

// --- encode PNG ---
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6
const out = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(cropRaw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, out)
console.log(`wrote ${path.relative(root, OUT)} — ${S}x${S}`)
