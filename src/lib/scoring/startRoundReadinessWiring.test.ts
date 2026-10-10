import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * My HQ V2 Phase D (10 Oct) Task #39 -- Stage 1 readiness, wired for
 * real. Built only after auditing:
 *   - src/app/(app)/trips/[tripId]/tournament/page.tsx (confirmed: no
 *     group/player/handicap data already in scope on that page)
 *   - src/components/scoring/BeginRoundModal.tsx (confirmed: the real
 *     Begin Round wizard already calls GET .../setup-context for
 *     exactly this data, and already runs
 *     resolvePlayingHandicap(playing_handicap, profile_handicap) !== null
 *     as its own per-player readiness check)
 *   - src/app/api/trips/[tripId]/rounds/[roundId]/setup-context/route.ts
 *     (confirmed: returns `groups: [{ id, name, tee_time, players: [{
 *     member_id, profile_id, full_name, playing_handicap,
 *     profile_handicap }] }]` -- exactly the shape needed, with no
 *     reshaping or new server-side query required)
 *
 * MyHQClient.tsx is a client component with no DOM/React test harness
 * in this project, so -- matching this codebase's own established
 * convention (see makersBreakersStage4Fix.test.ts,
 * stage5SlideshowDeepLink.test.ts) -- these are static source-level
 * checks confirming the wiring reuses the EXISTING endpoint and the
 * EXISTING resolvePlayingHandicap() helper verbatim, rather than
 * inventing a new speculative query or duplicating the wizard's own
 * validation logic.
 */

const here = dirname(fileURLToPath(import.meta.url))
const myHqClientSrc = readFileSync(
  resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8',
)

test('MyHQClient fetches the EXISTING setup-context endpoint -- the Begin Round wizard\'s own data source -- not a new route', () => {
  assert.match(myHqClientSrc, /fetch\(`\/api\/trips\/\$\{tripId\}\/rounds\/\$\{selected!\.id\}\/setup-context`\)/)
})

test('MyHQClient reuses resolvePlayingHandicap() verbatim -- imported, not reimplemented -- for the exact same per-player check the wizard already performs', () => {
  assert.match(myHqClientSrc, /import \{ resolvePlayingHandicap \} from '@\/lib\/scoring\/defaultHoles'/)
  assert.match(myHqClientSrc, /resolvePlayingHandicap\(p\.playing_handicap, p\.profile_handicap\) === null/)
})

test('the setup-context query is only enabled while the round is upcoming -- no needless fetching/polling once Stage 1 is already complete', () => {
  const queryBlock = myHqClientSrc.match(/queryKey: \['setup-context', tripId, selected\?\.id\][\s\S]*?\n {2}\}\)/)
  assert.ok(queryBlock, 'expected to find the setup-context useQuery block')
  assert.match(queryBlock![0], /enabled: !!selected && selected\.status === 'upcoming'/)
})

test('startReadiness is computed via deriveStartRoundReadiness() and threaded into deriveRoundWorkflow() -- no parallel readiness calculation', () => {
  assert.match(myHqClientSrc, /import \{ deriveRoundWorkflow, deriveEventProgress, deriveStartRoundReadiness,/)
  assert.match(myHqClientSrc, /const startReadiness = setupContextData \? deriveStartRoundReadiness\(\{/)
  assert.match(myHqClientSrc, /startReadiness,\s*\n\s*startReadinessLoading,\s*\n\s*startReadinessError,\s*\n {2}\}\) : null/)
})

test('groupCount and assignedPlayerCount are derived straight from the fetched groups array -- no invented counts', () => {
  assert.match(myHqClientSrc, /groupCount: setupContextData\.groups\.length/)
  assert.match(myHqClientSrc, /assignedPlayerCount: setupContextData\.groups\.reduce\(\(sum, g\) => sum \+ g\.players\.length, 0\)/)
})
