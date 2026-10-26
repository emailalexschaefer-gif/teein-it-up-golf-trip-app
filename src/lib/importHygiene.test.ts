// Guards against "Identifier 'X' has already been declared" build failures: no source file may import the same name twice.
// (A syntax-only transpile does not catch this; `next build` does.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : /\.(ts|tsx)$/.test(n) && out.push(p) }
  return out
}
test('no source file imports the same identifier twice', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    const s = readFileSync(f, 'utf8'); const names: string[] = []
    for (const m of s.matchAll(/^import\s+(?:type\s+)?([^;]*?)\s+from\s+'[^']+'/gms)) {
      const clause = m[1]
      const d = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/); if (d) names.push(d[1])
      for (const b of clause.matchAll(/\{([^}]*)\}/g)) for (const raw of b[1].split(',')) { const n = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim(); if (n) names.push(n) }
    }
    const dup = [...new Set(names.filter(n => names.filter(x => x === n).length > 1))]
    if (dup.length) offenders.push(`${f.slice(SRC.length + 1)}: ${dup.join(', ')}`)
  }
  assert.deepEqual(offenders, [])
})
