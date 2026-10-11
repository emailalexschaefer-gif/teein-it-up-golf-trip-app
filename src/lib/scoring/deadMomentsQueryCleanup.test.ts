import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E audit (11 Oct) -- confirmed-dead query cleanup.
 * TournamentControl.tsx used to run a `['moments', tripId, roundId]`
 * React Query fetch (`roundMomentsData`) whose own render site had
 * been removed in an earlier pass, leaving a wasted network request on
 * every mount/window-focus refetch. Static source-level check (no DOM
 * harness for this client component) confirming it stays removed, and
 * that Event Story's own separate, still-used ['moments', tripId]
 * query (unscoped, genuinely rendered) is untouched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const tournamentControlSrc = readFileSync(
  resolve(here, '../../components/scoring/TournamentControl.tsx'), 'utf8',
)

test('the dead round-scoped moments query is gone -- no active declaration or queryKey remains (an explanatory comment may still mention the old name/key in prose)', () => {
  assert.ok(!/const \{ data: roundMomentsData \}/.test(tournamentControlSrc), 'the roundMomentsData hook declaration should no longer exist in this file')
  assert.ok(!/queryKey: \['moments', tripId, roundId\]/.test(tournamentControlSrc), 'the round-scoped moments queryKey should no longer be used by an active query in this file')
})

test('Event Story\'s own separate, still-used unscoped moments query is untouched', () => {
  assert.match(tournamentControlSrc, /queryKey: \['moments', tripId\]/)
})
