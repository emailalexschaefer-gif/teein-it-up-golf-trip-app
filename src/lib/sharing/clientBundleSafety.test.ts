import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression guard for the Vercel build failure "UnhandledSchemeError: node:crypto" --
// a client component (EventMessages) reached node:crypto through lib/sharing/token.ts.
// Every module reachable from a 'use client' file must be free of node: / crypto imports.
const SRC = fileURLToPath(new URL('../..', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p)
  }
  return out
}
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx'), base]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

test('no module reachable from a client component imports node:* / crypto', () => {
  const files = walk(SRC)
  const clientFiles = files.filter(f => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))
  assert.ok(clientFiles.length > 20)
  const bad: string[] = []
  const seen = new Set<string>()
  const visit = (f: string, via: string) => {
    if (seen.has(f)) return
    seen.add(f)
    // type-only imports are erased at build time and cannot pull server code into the bundle
    const src = readFileSync(f, 'utf8').replace(/import\s+type\s[^;]*?from\s+['"][^'"]+['"]/g, '')
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (!spec) continue
      if (/^node:/.test(spec) || spec === 'crypto' || spec === 'fs' || spec === 'path') { bad.push(`${f.replace(SRC, 'src/')} imports ${spec} (via ${via})`); continue }
      if (/supabase\/admin|sharing\/server|sharing\/publish|sharing\/token$|leaderboardShare\/service$/.test(spec)) { bad.push(`${f.replace(SRC, 'src/')} imports server-only ${spec}`); continue }
      const r = resolveImport(f, spec)
      if (r) visit(r, via)
    }
  }
  for (const f of clientFiles) visit(f, f.replace(SRC, 'src/'))
  assert.deepEqual(bad, [])
})

test('the Chat card path specifically stays browser-safe', () => {
  const chat = readFileSync(join(SRC, 'lib/sharing/chatMessage.ts'), 'utf8')
  assert.ok(!/from '\.\/token'/.test(chat) && /tokenShape/.test(chat))
})
