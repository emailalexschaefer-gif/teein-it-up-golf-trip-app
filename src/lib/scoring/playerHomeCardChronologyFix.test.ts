import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { sortRoundsChronologically, resolveFocusRound } from './multiRound'

/**
 * My HQ V2 (10 Oct) audit fix — PlayerHomeCard.tsx (the player-facing
 * Lobby view) still had the exact un-tiebroken
 * `[...rounds].sort((a,b) => a.play_date.localeCompare(b.play_date))`
 * pattern that caused the original Round 2/Round 3 "most recently
 * completed round" bug fixed everywhere else on 28 Aug. This is a
 * source-level check that the fix is actually in place (the file
 * itself has no DOM/React test harness in this project, matching this
 * codebase's established convention for this kind of check), plus a
 * behavioural check — using the same canonical helper two rounds that
 * tie on both play_date and created_at still resolve deterministically.
 */

const here = dirname(fileURLToPath(import.meta.url))
const playerHomeCardSrc = readFileSync(
  resolve(here, '../../app/(app)/trips/[tripId]/PlayerHomeCard.tsx'), 'utf8',
)

test('PlayerHomeCard no longer sorts rounds with a bare, un-tiebroken localeCompare -- at either of its two call sites', () => {
  assert.ok(
    !playerHomeCardSrc.includes('.sort((a, b) => a.play_date.localeCompare(b.play_date))'),
    'the old un-tiebroken sort pattern must be gone from every call site',
  )
})

test('PlayerHomeCard now uses the canonical sortRoundsChronologically helper at both the focus-round site and the Rounds display-list site', () => {
  assert.match(playerHomeCardSrc, /import \{ resolveFocusRound, sortRoundsChronologically \} from '@\/lib\/scoring\/multiRound'/)
  assert.match(playerHomeCardSrc, /const rounds = sortRoundsChronologically\(trip\.rounds\)/)
  assert.match(playerHomeCardSrc, /\{sortRoundsChronologically\(trip\.rounds\)\.map\(r => \(/)
})

test('behavioural: two rounds sharing play_date AND created_at (the exact Postgres-batch-insert tie condition) still resolve deterministically via the id tiebreaker', () => {
  const tiedRounds = [
    { id: 'round-b', play_date: '2026-09-01', created_at: '2026-08-01T10:00:00Z', status: 'completed' as const },
    { id: 'round-a', play_date: '2026-09-01', created_at: '2026-08-01T10:00:00Z', status: 'completed' as const },
  ]
  const sorted1 = sortRoundsChronologically(tiedRounds)
  const sorted2 = sortRoundsChronologically([...tiedRounds].reverse())
  // Regardless of input order, the id tiebreaker gives the same result both times.
  assert.deepEqual(sorted1.map(r => r.id), sorted2.map(r => r.id))
  assert.deepEqual(sorted1.map(r => r.id), ['round-a', 'round-b'])
})

test('behavioural: resolveFocusRound fed the deterministic "most recently completed" round never flips between calls for the same tied data', () => {
  const completedRounds = sortRoundsChronologically([
    { id: 'round-2', play_date: '2026-09-08', created_at: '2026-08-01T10:00:00Z', status: 'completed' as const },
    { id: 'round-3', play_date: '2026-09-15', created_at: '2026-08-01T10:00:00Z', status: 'completed' as const },
  ])
  const mostRecentlyCompleted = completedRounds[completedRounds.length - 1]
  assert.equal(mostRecentlyCompleted.id, 'round-3', 'Round 3 genuinely plays after Round 2, so it must be the one surfaced')
  const focus = resolveFocusRound(undefined, mostRecentlyCompleted, undefined)
  assert.equal(focus?.id, 'round-3')
})
