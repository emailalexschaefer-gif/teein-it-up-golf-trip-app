import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPresentationDeck, defaultPresentationConfig, getAvailableSections } from './slideshowDeck'
import { generateEventMakersAndBreakers } from '@/lib/highlights/eventMakersBreakers'
import type { EventMemoryData } from './eventMemoryData'

// Lappen: Round 1 played, Round 2 (Flinders) cancelled, event ended early.
function lappen(championDeclared: boolean): EventMemoryData {
  const standings = [
    { playerId: 'p1', playerName: 'Alex Schaefer', totalPoints: 41, position: 1 },
    { playerId: 'p2', playerName: 'Daz', totalPoints: 38, position: 2 },
    { playerId: 'p3', playerName: 'Sam Carter', totalPoints: 30, position: 3 },
  ]
  return {
    event: { id: 't1', name: 'Lappen Invitational', eventType: 'tournament', location: 'Adelaide', startDate: '2026-10-24', endDate: '2026-10-25', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [{
      id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18,
      publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3 holes' }],
      winners: [{ playerId: 'p1', playerName: 'Alex Schaefer', points: 41 }],
      standings: standings.map(s => ({ playerId: s.playerId, playerName: s.playerName, roundPoints: s.totalPoints, position: s.position })),
      cumulativeStandings: null, cumulativeRoundsIncluded: 1,
    }],
    memories: [],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex Schaefer' }],
    sideGameCount: 1, playerCount: 20,
    results: { champion: {
      championDeclared, endedEarly: true,
      champions: championDeclared ? [{ playerId: 'p1', playerName: 'Alex Schaefer', totalPoints: 41 }] : [],
      hasTie: false, standings,
    } },
  } as unknown as EventMemoryData
}
const deckOf = (d: EventMemoryData) => buildPresentationDeck(d, defaultPresentationConfig(d, { kind: 'fullEvent' }))
const kinds = (d: EventMemoryData) => deckOf(d).slides.map(s => s.kind)

test('ended early, NO champion: no champion slide, but the presentation is complete and playable', () => {
  const d = lappen(false), k = kinds(d)
  assert.ok(!k.includes('champion'), `champion slide must be absent (got ${k.join(',')})`)
  for (const need of ['opening', 'eventAtAGlance', 'roundDivider', 'sideGameWinner', 'leaderboard', 'closing'] as const) assert.ok(k.includes(need), `missing ${need}`)
  assert.equal(k[k.length - 1], 'closing')
})

test('no champion anywhere in the deck data: not as a slide, not in metadata', () => {
  const deck = deckOf(lappen(false)); const json = JSON.stringify(deck.slides)
  assert.ok(!/"kind":"champion"/.test(json))
  assert.ok(!/event_champion/.test(json), 'no champion highlight slipped in')
  const lb = deck.slides.find(s => s.kind === 'leaderboard') as unknown as { championDeclared?: boolean; endedEarly?: boolean }
  assert.equal(lb.championDeclared, false); assert.equal(lb.endedEarly, true)
  const glance = deck.slides.find(s => s.kind === 'eventAtAGlance') as unknown as { championDeclared?: boolean; playerCount?: number }
  assert.equal(glance.championDeclared, false); assert.equal(glance.playerCount, 20)
})

test('Final Standings stays available without a champion; the Champion section is unavailable with a clear reason', () => {
  const sections = getAvailableSections(lappen(false), { kind: 'fullEvent' })
  const champ = sections.find(s => s.type === 'EVENT_CHAMPION')
  if (champ) { assert.equal(champ.available, false); assert.match(String(champ.reason), /No overall champion/) }
  const lb = sections.find(s => s.type === 'FINAL_LEADERBOARD'); assert.ok(lb && lb.available); assert.equal(lb!.label, 'Final Standings')
})

test('ended early WITH champion declared: champion slide appears', () => {
  const k = kinds(lappen(true)); assert.ok(k.includes('champion')); assert.ok(k.includes('leaderboard'))
  const sections = getAvailableSections(lappen(true), { kind: 'fullEvent' })
  assert.equal(sections.find(s => s.type === 'EVENT_CHAMPION')?.available, true)
})

test('round winners and side-game winners from the played round are kept when there is no champion', () => {
  const json = JSON.stringify(deckOf(lappen(false)).slides)
  assert.ok(json.includes('Longest Drive')); assert.ok(json.includes('Alex Schaefer'))
  assert.ok(!json.includes('Round 2') && !json.includes('Flinders'), 'no phantom cancelled round')
})

test('Makers & Breakers omits the event champion highlight when none is declared, and keeps it otherwise', () => {
  const h = (n: number, pts: number) => ({ holeNumber: n, par: 4, grossScore: 4, stablefordPts: pts })
  const pl = (id: string, name: string, pts: number) => ({ playerId: id, playerName: name, startingHole: 1, holes: [h(1, pts), h(2, pts)], groupId: null, groupName: '' })
  const rounds = [{ roundId: 'r1', roundNumber: 1, totalHoles: 9, players: [pl('a', 'Alex', 3), pl('b', 'Daz', 2)] }]
  const withChamp = generateEventMakersAndBreakers({ rounds })
  assert.ok(withChamp.makers.some(m => m.category === 'event_champion'), 'normal completion keeps the champion highlight')
  const none = generateEventMakersAndBreakers({ rounds, includeChampion: false })
  assert.ok(!none.makers.some(m => m.category === 'event_champion'), 'no champion highlight when none declared')
  assert.ok(none.makers.length > 0, 'other event makers are unaffected')
})
