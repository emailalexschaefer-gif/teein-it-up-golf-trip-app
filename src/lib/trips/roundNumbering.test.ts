import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { numberRounds, canonicalRoundLabel, canonicalRoundLabelWithStatus } from './roundNumbering'
import { buildRoundsSummary, selectRelevantSideGameRounds } from '@/lib/scoring/multiRound'
import { buildPresentationDeck, defaultPresentationConfig } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
type R = { id: string; name: string; play_date: string; created_at: string; status: string }
const three: R[] = [
  { id: 'a', name: 'Round 1', play_date: '2026-10-24', created_at: '1', status: 'completed' },
  { id: 'b', name: 'Round 2', play_date: '2026-10-25', created_at: '2', status: 'cancelled' },
  { id: 'c', name: 'Round 3', play_date: '2026-10-26', created_at: '3', status: 'completed' },
]

test('three rounds, middle cancelled: numbers 1,2,3; Round 3 is never Round 2', () => {
  const n = numberRounds(three)
  assert.deepEqual(three.map(r => n.get(r.id)), [1, 2, 3])
  assert.deepEqual(three.map(r => canonicalRoundLabel(r, n)), ['Round 1', 'Round 2', 'Round 3'])
  assert.equal(canonicalRoundLabelWithStatus(three[1], n), 'Round 2 \u2014 Cancelled')
  assert.equal(canonicalRoundLabelWithStatus(three[2], n), 'Round 3')
})
test('numbering does not depend on input order, status, or a filtered list', () => {
  const shuffled = [three[2], three[0], three[1]]
  const n = numberRounds(shuffled)
  assert.deepEqual(three.map(r => n.get(r.id)), [1, 2, 3])
  // the OLD behaviour (number a filtered list) would give Round 3 -> 2; prove the canonical map does not
  const filteredIdx = three.filter(r => r.status !== 'cancelled').findIndex(r => r.id === 'c') + 1
  assert.equal(filteredIdx, 2); assert.equal(n.get('c'), 3)
})
test('same-day rounds keep a deterministic order (created_at, then id)', () => {
  const same: R[] = [
    { id: 'z', name: 'Round 2', play_date: '2026-10-24', created_at: '2', status: 'upcoming' },
    { id: 'y', name: 'Round 1', play_date: '2026-10-24', created_at: '1', status: 'upcoming' },
  ]
  const n = numberRounds(same); assert.equal(n.get('y'), 1); assert.equal(n.get('z'), 2)
})
test('adding Round 3 after completing Round 1 changes nothing for Rounds 1 and 2', () => {
  const before = numberRounds(three.slice(0, 2)); const after = numberRounds(three)
  assert.equal(before.get('a'), after.get('a')); assert.equal(before.get('b'), after.get('b'))
})
test('cancel / restore does not move any number or label', () => {
  const restored = three.map(r => r.id === 'b' ? { ...r, status: 'upcoming' } : r)
  assert.deepEqual([...numberRounds(restored)], [...numberRounds(three)])
})
test('custom round names are kept; stale auto names are corrected to the canonical number', () => {
  const n = numberRounds(three)
  assert.equal(canonicalRoundLabel({ id: 'c', name: 'Sunday Final' }, n), 'Sunday Final')
  assert.equal(canonicalRoundLabel({ id: 'c', name: 'Round 2' }, n), 'Round 3', 'stored "Round 2" on the 3rd round displays as Round 3')
  assert.equal(canonicalRoundLabel({ id: 'c', name: '' }, n), 'Round 3')
  assert.equal(canonicalRoundLabel({ id: 'unknown', name: 'Round 9' }, n), 'Round 9', 'unknown id falls back to the stored name')
})
test('leaderboard round columns carry canonical numbers when the cancelled round is dropped from the list', () => {
  const n = numberRounds(three)
  const shown = three.filter(r => r.status !== 'cancelled')
  assert.deepEqual(buildRoundsSummary(shown, n).map(r => r.roundNumber), [1, 3])
  assert.deepEqual(buildRoundsSummary(shown).map(r => r.roundNumber), [1, 2], 'without the map it would renumber (the old bug)')
})
test('side games list only played rounds but keep their canonical numbers', () => {
  const n = numberRounds(three)
  assert.deepEqual(selectRelevantSideGameRounds(three).map(r => n.get(r.id)), [1, 3])
})

test('Event Presentation: Round 3 results still say Round 3 when Round 2 was cancelled', () => {
  const mk = (id: string, ord: number, name: string, pts: number) => ({
    id, ordinal: ord, name, courseName: 'C', playDate: `2026-10-2${3 + ord}`, status: 'completed', holes: 18, hasRecordedScores: true,
    publishedHighlights: [], winners: [{ playerId: 'p1', playerName: 'Alex', roundPoints: pts }],
    standings: [{ playerId: 'p1', playerName: 'Alex', roundPoints: pts, position: 1 }, { playerId: 'p2', playerName: 'Daz', roundPoints: pts - 3, position: 2 }],
    cumulativeStandings: null, cumulativeRoundsIncluded: ord,
  })
  const data = {
    event: { id: 't', name: 'Lappen', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-26', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [mk('r1', 1, 'Round 1', 40), mk('r3', 3, 'Round 3', 38)], // Round 2 is cancelled -> absent from the manifest, number 2 stays unused
    memories: [], sideGameWinners: [], sideGameCount: 0, playerCount: 2,
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 78 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 78, position: 1 }] } },
  } as unknown as EventMemoryData
  const json = JSON.stringify(buildPresentationDeck(data, defaultPresentationConfig(data, { kind: 'fullEvent' })).slides)
  assert.ok(json.includes('Round 3'), 'Round 3 present')
  assert.ok(!json.includes('Round 2'), 'no Round 2 (cancelled) and Round 3 not mislabelled')
})

test('every screen takes round numbers from the canonical helper, never from a filtered list position', () => {
  assert.match(read('src/lib/trips/finalResults.ts'), /numberRounds\(sortedRounds\)/)
  assert.doesNotMatch(read('src/lib/trips/finalResults.ts'), /roundNumber: (idx|roundIdx) \+ 1/)
  assert.match(read('src/lib/leaderboardShare/service.ts'), /numberRounds\(allRounds\)/)
  assert.match(read('src/lib/scoring/roundLeaderboard.ts'), /buildRoundsSummary\(sortedRelevantRounds, roundNumbering\)/)
  assert.match(read('src/app/api/trips/[tripId]/side-games/route.ts'), /numbering\.get\(round\.id\)/)
  assert.match(read('src/lib/trips/eventMemoryData.ts'), /roundOrdinalById = roundNumbering/)
  assert.match(read('src/app/(app)/trips/[tripId]/memories/page.tsx'), /R\{r\.ordinal \?\? i \+ 1\}/)
})
test('display labels never rewrite stored names: no round name is written by the numbering code', () => {
  for (const f of ['src/lib/trips/roundNumbering.ts', 'src/lib/trips/roundLabels.ts']) assert.doesNotMatch(read(f), /\.update\(|\.upsert\(|\.insert\(/)
})
