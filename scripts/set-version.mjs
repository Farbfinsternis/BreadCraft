// Writes a validated x.y.z version into package.json. Called by build.bat.
// Usage: node scripts/set-version.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Ungültige Version: "${version ?? ''}". Erwartet: x.y.z (z. B. 0.1.0)`)
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log(`Version in package.json gesetzt: ${version}`)
