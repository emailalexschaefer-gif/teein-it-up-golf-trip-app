import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEADERBOARD_POLL_MS, LEADERBOARD_MAX_BACKOFF_MS, PUBLIC_LEADERBOARD_CACHE, nextPollDelay, isRefreshStale } from './refreshPolicy'

const ROOT = process.cwd()
const view = readFileSync(join(ROOT, 'src/components/leaderboard/PublicLeaderboardView.tsx'), 'utf8')
const route = readFileSync(join(ROOT, 'src/app/api/l/[token]/route.ts'), 'utf8')

test('spectator poll is 10-15 seconds and worst-case staleness (CDN + poll) stays near the 15s acceptance target', () => {
  assert.ok(LEADERBOARD_POLL_MS >= 10000 && LEADERBOARD_POLL_MS <= 15000)
  assert.equal(PUBLIC_LEADERBOARD_CACHE, 'public, s-maxage=5')
  assert.doesNotMatch(PUBLIC_LEADERBOARD_CACHE, /stale-while-revalidate/)
  assert.match(route, /PUBLIC_CACHE = 'public, s-maxage=5'/)
})
test('backoff grows while failing, is capped, and resets to the normal cadence', () => {
  assert.equal(nextPollDelay(0), LEADERBOARD_POLL_MS)
  assert.equal(nextPollDelay(1), LEADERBOARD_POLL_MS * 2)
  assert.equal(nextPollDelay(3), 60000 > LEADERBOARD_POLL_MS * 8 ? LEADERBOARD_POLL_MS * 8 : 60000)
  for (let n = 0; n < 20; n++) assert.ok(nextPollDelay(n) <= LEADERBOARD_MAX_BACKOFF_MS)
  assert.equal(nextPollDelay(Number.NaN), LEADERBOARD_POLL_MS)
})
test('stale indicator: not on a single blip, yes after two failures or 90s without success', () => {
  assert.equal(isRefreshStale(0, 5000), false)
  assert.equal(isRefreshStale(1, 20000), false)
  assert.equal(isRefreshStale(2, 20000), true)
  assert.equal(isRefreshStale(1, 91000), true)
  assert.equal(isRefreshStale(1, null), false)
})
test('view: no overlapping requests, immediate refresh on visible/online, nothing pending while hidden, real last-success time', () => {
  assert.match(view, /if \(inFlight\.current\) return/)
  assert.match(view, /addEventListener\('visibilitychange', resume\)/)
  assert.match(view, /addEventListener\('online', resume\)/)
  assert.match(view, /document\.visibilityState === 'hidden'\) return/)
  assert.match(view, /cache: 'no-store'/)
  assert.match(view, /lastOkRef\.current = now/)
  assert.match(view, /res\.status === 404\) \{ setGone\(true\)/)
})
test('public route stays read-only, session-free and token-gated', () => {
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(route, /supabase\/server|createClient/)
  assert.match(route, /resolveToken\(admin, token\)/)
})
