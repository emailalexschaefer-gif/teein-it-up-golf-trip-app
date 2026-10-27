import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPresentationDeck, defaultPresentationConfig, getAvailableSections } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

// Lappen Invitational acceptance scenario. Round 1 (Saturday) was played and
// completed; Round 2 (Flinders) was cancelled before starting. The manifest
// builder excludes cancelled rounds at the source (pinned in
// roundCancellation.test.ts), so the presentation sees exactly one round.
function lappenManifest(): EventMemoryData {
  return {
    event: { id: 't1', name: 'Lappen Invitational', eventType: 'tournament', location: 'Adelaide', startDate: '2026-10-24', endDate: '2026-10-25', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [{
      id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18,
      publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3 holes' }],
      winners: [{ playerId: 'p1', playerName: 'Alex Schaefer', roundPoints: 41 }],
      standings: [
        { playerId: 'p1', playerName: 'Alex Schaefer', roundPoints: 41, position: 1 },
        { playerId: 'p2', playerName: 'Daz', roundPoints: 38, position: 2 },
      ],
      cumulativeStandings: null, cumulativeRoundsIncluded: 1,
    } as unknown as EventMemoryData['rounds'][number]],
    memories: [],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex Schaefer' }],
    sideGameCount: 1, playerCount: 20,
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex Schaefer', totalPoints: 41 }], hasTie: false, standings: [
      { playerId: 'p1', playerName: 'Alex Schaefer', totalPoints: 41, position: 1 },
      { playerId: 'p2', playerName: 'Daz', totalPoints: 38, position: 2 },
    ] } },
  } as unknown as EventMemoryData
}

test('Lappen: the full Event Presentation builds from one completed round (cancelled round absent)', () => {
  const data = lappenManifest()
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  const deck = buildPresentationDeck(data, config)
  const kinds = deck.slides.map(s => s.kind)
  for (const k of ['opening', 'eventAtAGlance', 'roundDivider', 'sideGameWinner', 'leaderboard', 'champion', 'closing'] as const) {
    assert.ok(kinds.includes(k), `missing slide kind: ${k} (got ${kinds.join(',')})`)
  }
  assert.ok(kinds.includes('makersBreakersCard') || kinds.includes('maker'), 'Makers & Breakers present')
  const glance = deck.slides.find(s => s.kind === 'eventAtAGlance') as { roundCount: number; courseNames: string[] }
  assert.equal(glance.roundCount, 1); assert.deepEqual(glance.courseNames, ['Eagle Ridge'])
  const champion = deck.slides.find(s => s.kind === 'champion') as { champions: { playerName: string; totalPoints: number }[] }
  assert.equal(champion.champions[0].playerName, 'Alex Schaefer'); assert.equal(champion.champions[0].totalPoints, 41)
  assert.equal(kinds.filter(k => k === 'roundDivider').length, 1, 'exactly one round section')
  assert.ok(!JSON.stringify(deck.slides).includes('Round 2'), 'no phantom Round 2 anywhere')
  assert.equal(kinds[kinds.length - 1], 'closing')
})

test('Lappen: every section is available for a one-round completed event', () => {
  const sections = getAvailableSections(lappenManifest(), { kind: 'fullEvent' })
  assert.ok(sections.length > 0)
  assert.ok(sections.some(s => s.type === 'EVENT_AT_A_GLANCE' && s.available))
  assert.ok(sections.some(s => s.type === 'ROUND_INTRO' && s.available))
})

// ---- 27 Oct presentation polish: builder-layer eligibility (Lappen regression) ----
const zeroStandings = Array.from({ length: 20 }, (_, i) => ({ playerId: `z${i}`, playerName: `Player ${i}`, roundPoints: 0, position: 1 }))
function withRound2(status: string, hasRecordedScores?: boolean): EventMemoryData {
  const d = lappenManifest()
  d.rounds = [...d.rounds, {
    id: 'r2', ordinal: 2, name: 'Round 2', courseName: 'Flinders', playDate: '2026-10-25', status, holes: 18, hasRecordedScores,
    publishedHighlights: [], winners: zeroStandings.map(s => ({ playerId: s.playerId, playerName: s.playerName, roundPoints: 0 })),
    standings: zeroStandings, cumulativeStandings: zeroStandings.map(s => ({ ...s, totalPoints: 0 })), cumulativeRoundsIncluded: 2,
  } as unknown as EventMemoryData['rounds'][number]]
  return d
}
function allText(data: EventMemoryData) {
  const deck = buildPresentationDeck(data, defaultPresentationConfig(data, { kind: 'fullEvent' }))
  return { deck, json: JSON.stringify(deck.slides), kinds: deck.slides.map(s => s.kind) }
}

test('Lappen: cancelled Round 2 with zero-point "winners" produces no Round 2 results, winners or section', () => {
  const { json, kinds, deck } = allText(withRound2('cancelled'))
  assert.equal(kinds.filter(k => k === 'roundDivider').length, 1)
  assert.equal(kinds.filter(k => k === 'roundResults').length <= 1, true)
  assert.ok(!json.includes('Round 2') && !json.includes('Flinders') && !json.includes('Player 0'))
  const glance = deck.slides.find(s => s.kind === 'eventAtAGlance') as { roundCount: number }
  assert.equal(glance.roundCount, 1)
})
test('Lappen: completed-but-unscored Round 2 (hasRecordedScores=false) is excluded the same way', () => {
  const { json, kinds } = allText(withRound2('completed', false))
  assert.equal(kinds.filter(k => k === 'roundDivider').length, 1)
  assert.ok(!json.includes('Round 2') && !json.includes('Player 0'))
})
test('legitimate played round that contains zero scores is kept (zero points never means cancelled)', () => {
  const d = withRound2('completed', true)
  d.rounds[1].standings = [{ playerId: 'p1', playerName: 'Alex Schaefer', roundPoints: 0, position: 1 }] as never
  const { kinds } = allText(d)
  assert.equal(kinds.filter(k => k === 'roundDivider').length, 2)
})
test('Round 1 results, valid achievements and champion survive a cancelled Round 2', () => {
  const { json, deck } = allText(withRound2('cancelled'))
  assert.ok(json.includes('Hot Start') && json.includes('Longest Drive'))
  const champion = deck.slides.find(s => s.kind === 'champion') as { champions: { playerName: string }[] }
  assert.equal(champion.champions[0].playerName, 'Alex Schaefer')
})
test('Top five: 20 players tied on one score never produce a 20-row slide beyond joint leaders, and a cross-fifth tie is excluded', () => {
  const d = lappenManifest()
  const st = [1, 2, 3, 4, 4, 4, 7].map((position, i) => ({ playerId: `q${i}`, playerName: `Q${i}`, totalPoints: 40 - i, position }))
  d.results = { champion: { champions: [], hasTie: false, standings: st } } as never
  const { deck } = allText(d)
  const lb = deck.slides.find(s => s.kind === 'leaderboard') as { entries: unknown[]; moreTied?: { position: number; count: number } | null }
  assert.equal(lb.entries.length, 3); assert.deepEqual(lb.moreTied, { position: 4, count: 3 })
})
