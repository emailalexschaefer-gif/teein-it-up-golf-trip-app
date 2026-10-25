import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { computePngLayout, PngTooLargeError, PNG_WIDTH, MAX_CANVAS_PIXELS } from './exportPng'
import { fixtureBoard } from './boardFixtures'
import { isPublicRoute } from '@/lib/auth/publicRoutes'
import { safeFilename } from './exportSave'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const wrap = (t: string) => [t]

// ── PNG layout ────────────────────────────────────────────────────────────
test('PNG layout: 2, 20 and 50 players fit under the canvas cap at a usable scale', () => {
  for (const n of [0, 2, 20, 50, 100]) {
    const l = computePngLayout(fixtureBoard(n), wrap)
    assert.equal(l.width, PNG_WIDTH); assert.ok(l.scale >= 1 && l.scale <= 2, `${n}: ${l.scale}`)
    assert.ok(l.width * l.scale * l.height * l.scale <= MAX_CANVAS_PIXELS * 1.001)
  }
  assert.equal(computePngLayout(fixtureBoard(20), wrap).scale, 2)
})

test('PNG layout: a field too big for one image is refused with PngTooLargeError (PDF is the fallback)', () => {
  assert.throws(() => computePngLayout(fixtureBoard(400), wrap), PngTooLargeError)
  assert.throws(() => computePngLayout(fixtureBoard(400), wrap), /Use the PDF instead/)
})

test('filenames are safe', () => {
  assert.equal(safeFilename('Lappen Invitational', 'pdf'), 'Lappen-Invitational-leaderboard.pdf')
  assert.equal(safeFilename('../../etc/passwd "x"', 'png'), 'etcpasswd-x-leaderboard.png')
  assert.equal(safeFilename('中文', 'png'), 'leaderboard-leaderboard.png')
})

// ── public access ─────────────────────────────────────────────────────────
test('the public page and API open without login; nothing else was made public', () => {
  assert.equal(isPublicRoute('/l/' + 'a'.repeat(43)), true)
  assert.equal(isPublicRoute('/api/l/' + 'a'.repeat(43)), true)
  for (const p of ['/api/trips/t1/share-leaderboard', '/api/trips/t1/leaderboard-snapshot', '/trips/t1/leaderboard', '/api/trips/t1/rounds/r1/leaderboard']) assert.equal(isPublicRoute(p), false, p)
})

test('public API is cached briefly at the CDN, read-only, indexed by no one, and 404s are identical and uncached', () => {
  const src = read('src/app/api/l/[token]/route.ts')
  assert.match(src, /PUBLIC_CACHE = 'public, s-maxage=15, stale-while-revalidate=30'/)
  assert.match(src, /noindex, nofollow/); assert.match(src, /no-referrer/)
  assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(src), false)
  assert.equal((src.match(/return notFound\(\)/g) ?? []).length === 2, true)
  assert.equal(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src), false)
  assert.equal(/supabase\/server|createClient/.test(src), false, 'public route must not depend on a session')
})

test('the public page is noindex, shows no private chrome, and the view polls only while visible', () => {
  const page = read('src/app/l/[token]/page.tsx'); const view = read('src/components/leaderboard/PublicLeaderboardView.tsx')
  assert.match(page, /robots: \{ index: false, follow: false \}/)
  assert.match(view, /visibilityState/); assert.match(view, /POLL_MS = 30000/)
  assert.equal(/localStorage|document\.cookie/.test(view), false)
})

// ── permissions ───────────────────────────────────────────────────────────
test('share-leaderboard: every member may read status; only the organiser may enable or revoke; enabling needs acknowledgement', () => {
  const src = read('src/app/api/trips/[tripId]/share-leaderboard/route.ts')
  const post = src.slice(src.indexOf('export async function POST'), src.indexOf('export async function DELETE'))
  const del = src.slice(src.indexOf('export async function DELETE'))
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  assert.match(post, /role !== 'organiser'[\s\S]*403/); assert.match(post, /acknowledge !== true[\s\S]*400/)
  assert.match(del, /role !== 'organiser'[\s\S]*403/)
  assert.equal(/organiser/.test(get.replace('isOrganiser: a.role === \'organiser\'', '')), false, 'GET is not organiser-gated')
  assert.match(src, /Not a trip member[\s\S]*403|403[\s\S]*Not a trip member/)
  assert.match(post, /is_practice === true[\s\S]*409/)
})

test('snapshot route: members only, works with sharing off, never cached', () => {
  const src = read('src/app/api/trips/[tripId]/leaderboard-snapshot/route.ts')
  assert.match(src, /getMemberRole/); assert.match(src, /403/); assert.match(src, /NO_STORE_HEADERS/)
  assert.equal(/getActiveLink|shared_leaderboards/.test(src), false)
})

test('the member leaderboard route still delegates to the canonical computation and keeps its own auth, practice and 404 rules', () => {
  const src = read('src/app/api/trips/[tripId]/rounds/[roundId]/leaderboard/route.ts')
  assert.match(src, /computeRoundLeaderboard/); assert.match(src, /Not authenticated[\s\S]*401/); assert.match(src, /Not a trip member[\s\S]*403/)
  assert.match(src, /isPractice: true/); assert.match(src, /Round not found[\s\S]*404/)
  assert.match(src, /dynamic = 'force-dynamic'/)
})

// ── UI wiring ─────────────────────────────────────────────────────────────
test('Share Leaderboard is on the leaderboard page for everyone; the organiser sees the warning + acknowledgement and a revoke button', () => {
  assert.match(read('src/app/(app)/trips/[tripId]/leaderboard/page.tsx'), /<ShareLeaderboardButton tripId=\{tripId\} \/>/)
  const panel = read('src/components/leaderboard/ShareLeaderboardPanel.tsx')
  for (const s of ['Copy Link', 'Turn on public link', 'Turn off public link', 'full player names and scores', 'type="checkbox"', 'Image (PNG)', 'PDF', 'Share']) assert.ok(panel.includes(s), s)
  assert.match(panel, /disabled=\{!ack/); assert.match(panel, /window\.confirm/); assert.match(panel, /No emails, contact details, handicaps or chat/)
  assert.match(panel, /hasn&apos;t turned on the public link/)
})

// ── migration ─────────────────────────────────────────────────────────────
test('migration 098: new table only, RLS on with no policies, one active link per event, rollback documented, runs after 097', () => {
  const sql = read('supabase/migrations/098_shared_leaderboards.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.shared_leaderboards/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.equal(/CREATE POLICY/i.test(sql), false)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS shared_leaderboards_one_active_per_trip[\s\S]*WHERE status = 'active'/)
  assert.match(sql, /status IN \('active','revoked'\)/); assert.match(sql, /DROP TABLE IF EXISTS public\.shared_leaderboards/)
  assert.match(sql, /AFTER 097/)
  assert.equal(/ALTER TABLE public\.(?!shared_leaderboards)|DROP TABLE(?! IF EXISTS public\.shared_leaderboards)|UPDATE |DELETE FROM|INSERT INTO/i.test(sql.replace(/^--.*$/gm, '')), false, 'touches nothing else')
})

test('analytics and perf telemetry redact leaderboard tokens', () => {
  assert.match(read('src/lib/analytics/trackEvent.ts'), /\/l\//); assert.match(read('src/lib/perf/perfMetrics.ts'), /\/l\//)
})
