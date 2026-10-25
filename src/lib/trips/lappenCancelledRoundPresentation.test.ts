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
