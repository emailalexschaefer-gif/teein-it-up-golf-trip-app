import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canShowRoundResults, findMyRow, incompleteLabel } from './roundResultsView'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const comp = () => read('src/components/scoring/CompletedRoundResults.tsx')

test('only completed rounds show results; cancelled/upcoming/active never do', () => {
  assert.equal(canShowRoundResults('completed'), true)
  for (const s of ['cancelled', 'upcoming', 'active', '']) assert.equal(canShowRoundResults(s), false, s)
})

test('findMyRow picks the viewer, or null when they have no scorecard', () => {
  assert.equal(findMyRow([{ isCurrentUser: false, n: 1 }, { isCurrentUser: true, n: 2 }])?.n, 2)
  assert.equal(findMyRow([{ isCurrentUser: false }]), null)
  assert.equal(findMyRow([]), null)
})

test('incompleteLabel: finished rows have none; 9-hole and early-finish rows say how many holes', () => {
  assert.equal(incompleteLabel({ holesPlayed: 18, finished: true }, 18), null)
  assert.equal(incompleteLabel({ holesPlayed: 9, finished: true }, 9), null)
  assert.equal(incompleteLabel({ holesPlayed: 12, finished: false }, 18), 'Incomplete · 12/18 holes')
  assert.equal(incompleteLabel({ holesPlayed: 0, finished: false }, 9), 'Incomplete · 0/9 holes')
})

test('results panel is read-only: GET of the existing round leaderboard route only, no inputs or writes', () => {
  const c = comp()
  assert.match(c, /\/api\/trips\/\$\{tripId\}\/rounds\/\$\{roundId\}\/leaderboard`/)
  assert.doesNotMatch(c, /method:\s*['"](POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(c, /<input|<textarea|<select|contentEditable/)
  assert.equal((c.match(/fetch\(/g) ?? []).length, 1)
})

test('results are round-scoped (board), never cumulative standings', () => {
  const c = comp()
  assert.doesNotMatch(c, /cumulativeStandings/)
  assert.match(c, /data!?\.board/)
})

test('reuses the canonical scorecard component instead of re-implementing it', () => {
  assert.match(comp(), /InlineScorecard/)
  assert.match(read('src/components/scoring/LiveLeaderboard.tsx'), /export function InlineScorecard\(/)
  assert.match(comp(), /Playing handicap this round/)
})

test('cancelled rounds render nothing and make no request; panel wired into My Golf only for the selected round', () => {
  const c = comp()
  assert.match(c, /if \(!canShowRoundResults\(roundStatus\)\) return null/)
  assert.match(c, /enabled = canShowRoundResults\(roundStatus\) && panel !== 'none'/)
  const m = read('src/components/scoring/MyRoundClient.tsx')
  assert.match(m, /<CompletedRoundResults tripId=\{tripId\} roundId=\{selected\.id\}/)
  for (const keep of ['MyAchievementsSection', 'PlayerRoundView', 'MyGolfEventStory', 'WatchPresentationLink', 'MyEventStoriesSection']) assert.match(m, new RegExp(keep))
})

test('handicap snapshot is per round: scorecard handicap is only inserted, never updated after round start', () => {
  const m = read('src/app/api/trips/[tripId]/members/[memberId]/route.ts')
  assert.match(m, /ignoreDuplicates:\s*true/)
  assert.doesNotMatch(m, /from\('scorecards'\)\s*\.update/)
})
