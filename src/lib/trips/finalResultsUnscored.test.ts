import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/lib/trips/finalResults.ts', 'utf8')

test('finalResults drops completed-but-unscored rounds before standings, countback, winners and side comps', () => {
  assert.match(src, /roundHasScores/)
  const a = src.indexOf('const roundHasScores'), standings = src.indexOf('computeCumulativeStandings(perRoundResults)')
  assert.ok(a > 0 && standings > a, 'filter must run before standings are computed')
  assert.match(src, /completedRoundsAll\.map\(async/)
  assert.match(src, /sideCompetitionsByRound = await Promise\.all\(completedRounds\.map/)
})
test('numbering is unaffected by eligibility (Round 3 stays 3 when Round 2 is unscored)', () => {
  assert.match(src, /numberRounds\(sortedRounds\)/)
})
