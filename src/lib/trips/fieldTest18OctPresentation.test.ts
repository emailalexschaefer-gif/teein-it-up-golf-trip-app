import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPresentationDeck, defaultPresentationConfig, getAvailableSections, isNonWinnerSideGameMoment,
  type PresentationConfig, type Slide,
} from './slideshowDeck'
import { cumulativeThroughRounds } from './cumulativeThroughRound'
import type { EventMemoryData } from './eventMemoryData'

// ── fixtures (same shape as slideshowDeck.test.ts) ────────────────────────
function memory(o: Partial<EventMemoryData['memories'][number]> & { momentId: string }): EventMemoryData['memories'][number] {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerId: 'p1', playerName: null,
    capturedBy: null, capturedByName: null, caption: null,
    imagePath: 'x.jpg', imageUrl: `https://signed.example/${o.momentId}.jpg`, audience: 'everyone',
    createdAt: '2026-10-18T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null,
    mediaType: 'photo', durationSeconds: null, isBlooper: false, aftershowIncluded: null,
    ...o,
  }
}
function round(o: Partial<EventMemoryData['rounds'][number]> & { id: string; ordinal: number }): EventMemoryData['rounds'][number] {
  return { name: `Round ${o.ordinal}`, courseName: null, playDate: '2026-10-18', status: 'completed', holes: 18, publishedHighlights: null, winners: null, standings: null, ...o }
}
function data(o: Partial<EventMemoryData> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Mega Test Drive', eventType: 'tournament', location: null, startDate: '2026-10-18', endDate: '2026-10-18', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [], memories: [], sideGameWinners: [], sideGameCount: 0, playerCount: 4, results: { champion: null },
    ...o,
  }
}
const kinds = (slides: Slide[]) => slides.map(s => s.kind)

function fullConfig(d: EventMemoryData, patch: Partial<PresentationConfig> = {}): PresentationConfig {
  const c = defaultPresentationConfig(d, { kind: 'fullEvent' })
  return { ...c, ...patch }
}

// ── Issue 5: group photo is slide 2 ─────────────────────────────────────
test('ISSUE 5: a selected group photo is the SECOND slide, before Event by the Numbers', () => {
  const d = data({
    event: { ...data().event, groupPhotoMomentId: 'gp' },
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'gp', roundId: null, caption: 'The four' })],
  })
  const cfg = fullConfig(d)
  assert.equal(cfg.groupPhoto, true)
  assert.equal(cfg.eventAtAGlance, true)
  const deck = buildPresentationDeck(d, cfg)
  const k = kinds(deck.slides)
  assert.deepEqual(k.slice(0, 3), ['opening', 'groupPhoto', 'eventAtAGlance'])
  const gp = deck.slides[1] as Extract<Slide, { kind: 'groupPhoto' }>
  assert.equal(gp.momentId, 'gp')
})

test('ISSUE 5: the group photo is never substituted -- an unknown / non-photo selection simply produces no group slide', () => {
  const d = data({ event: { ...data().event, groupPhotoMomentId: 'missing' }, rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'other' })] })
  const deck = buildPresentationDeck(d, fullConfig(d, { groupPhoto: true }))
  assert.equal(kinds(deck.slides).includes('groupPhoto'), false)
  assert.equal(kinds(deck.slides)[1], 'eventAtAGlance')
})

test('ISSUE 5: group photo toggled off -> not shown; order of the remaining slides unchanged', () => {
  const d = data({ event: { ...data().event, groupPhotoMomentId: 'gp' }, rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'gp' })] })
  const deck = buildPresentationDeck(d, fullConfig(d, { groupPhoto: false }))
  assert.deepEqual(kinds(deck.slides).slice(0, 2), ['opening', 'eventAtAGlance'])
})

// ── Issue 3: only the official winner for a single-winner side game ──────
function sideGameData() {
  return data({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    sideGameWinners: [{ sideCompId: 'ntp6', roundId: 'r1', compType: 'nearest_pin', label: 'Nearest the Pin', holeNumber: 6, winnerPlayerId: 'darren', winnerName: 'Darren Lappen' }],
    memories: [
      memory({ momentId: 'alex-ntp', roundId: 'r1', playerId: 'alex', playerName: 'Alex Schaefer', sourceType: 'SIDE_GAME', sideCompId: 'ntp6', sideCompName: 'Nearest the Pin', holeNumber: 6 }),
      memory({ momentId: 'darren-ntp', roundId: 'r1', playerId: 'darren', playerName: 'Darren Lappen', sourceType: 'SIDE_GAME', sideCompId: 'ntp6', sideCompName: 'Nearest the Pin', holeNumber: 6 }),
      memory({ momentId: 'general', roundId: 'r1', playerId: 'alex', playerName: 'Alex Schaefer', holeNumber: 3 }),
    ],
  })
}
const allSource = (d: EventMemoryData) => fullConfig(d, { bestMomentsSource: 'all' })

test('ISSUE 3: one winner slide for Nearest the Pin Hole 6; the other player\'s submission is NOT a presentation slide', () => {
  const d = sideGameData()
  const deck = buildPresentationDeck(d, allSource(d))
  const winners = deck.slides.filter((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')
  assert.equal(winners.length, 1)
  assert.equal(winners[0].winnerName, 'Darren Lappen')
  const photoIds = deck.slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
  assert.equal(photoIds.includes('alex-ntp'), false, 'non-winner submission must not play')
  assert.equal(photoIds.includes('darren-ntp'), false, 'winner photo is used by the winner slide, not repeated')
  assert.equal(photoIds.includes('general'), true, 'ordinary Moments still play')
  // no slide anywhere names Alex in connection with the side game
  const text = JSON.stringify(deck.slides.filter(s => s.kind === 'sideGameWinner' || (s.kind === 'photo' && s.sideCompName)))
  assert.equal(/Alex/.test(text), false)
})

test('ISSUE 3: the winner slide uses the WINNER\'s own photo, never the other player\'s', () => {
  const d = sideGameData()
  const deck = buildPresentationDeck(d, allSource(d))
  const w = deck.slides.find((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')!
  assert.match(w.winnerImageUrl ?? '', /darren-ntp/)
})

test('ISSUE 3: a Side Game with NO decided winner keeps its Moments as ordinary photos (nothing is labelled a winner)', () => {
  const d = sideGameData()
  d.sideGameWinners = [{ ...d.sideGameWinners[0], winnerPlayerId: null, winnerName: null }]
  const deck = buildPresentationDeck(d, allSource(d))
  assert.equal(deck.slides.filter(s => s.kind === 'sideGameWinner').length, 0)
  const photoIds = deck.slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
  assert.deepEqual(photoIds.sort(), ['alex-ntp', 'darren-ntp', 'general'])
})

test('ISSUE 3: multiple independent competitions each get their own single winner slide', () => {
  const d = sideGameData()
  d.sideGameWinners.push({ sideCompId: 'ld12', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 12, winnerPlayerId: 'alex', winnerName: 'Alex Schaefer' })
  d.memories.push(memory({ momentId: 'alex-ld', roundId: 'r1', playerId: 'alex', sourceType: 'SIDE_GAME', sideCompId: 'ld12', sideCompName: 'Longest Drive', holeNumber: 12 }))
  d.memories.push(memory({ momentId: 'darren-ld', roundId: 'r1', playerId: 'darren', sourceType: 'SIDE_GAME', sideCompId: 'ld12', sideCompName: 'Longest Drive', holeNumber: 12 }))
  const deck = buildPresentationDeck(d, allSource(d))
  const winners = deck.slides.filter((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')
  assert.deepEqual(winners.map(w => `${w.label}:${w.winnerName}`).sort(), ['Longest Drive:Alex Schaefer', 'Nearest the Pin:Darren Lappen'])
  const photoIds = deck.slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
  assert.equal(photoIds.includes('darren-ld'), false)
  assert.equal(photoIds.includes('alex-ntp'), false)
})

test('ISSUE 3: an explicit hand-picked selection is the organiser\'s own choice and is left alone', () => {
  const d = sideGameData()
  const deck = buildPresentationDeck(d, fullConfig(d, { bestMomentsSource: 'selected', selectedMomentIds: ['alex-ntp'] }))
  const photoIds = deck.slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
  assert.deepEqual(photoIds, ['alex-ntp'])
})

test('ISSUE 3: isNonWinnerSideGameMoment truth table', () => {
  const winners = [{ sideCompId: 'c', winnerPlayerId: 'w' }]
  assert.equal(isNonWinnerSideGameMoment({ sideCompId: 'c', playerId: 'x' }, winners), true)
  assert.equal(isNonWinnerSideGameMoment({ sideCompId: 'c', playerId: 'w' }, winners), false)
  assert.equal(isNonWinnerSideGameMoment({ sideCompId: null, playerId: 'x' }, winners), false)
  assert.equal(isNonWinnerSideGameMoment({ sideCompId: 'other', playerId: 'x' }, winners), false)
  assert.equal(isNonWinnerSideGameMoment({ sideCompId: 'c', playerId: null }, winners), true)
})

// ── Issue 6: cumulative leaderboard slide after each round's results ─────
const P = (id: string, pts: number) => ({ playerId: id, playerName: id.toUpperCase(), roundPoints: pts })

test('ISSUE 6: cumulativeThroughRounds sums completed rounds in order, via the authoritative function', () => {
  const rounds = [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'completed' }, { id: 'r3', status: 'completed' }]
  const res = new Map([
    ['r1', [P('a', 30), P('b', 28), P('c', 20)]],
    ['r2', [P('a', 20), P('b', 35), P('c', 25)]],
    ['r3', [P('a', 40), P('b', 10), P('c', 25)]],
  ])
  const out = cumulativeThroughRounds(rounds, res)
  assert.equal(out.get('r1')!.roundsIncluded, 1)
  assert.deepEqual(out.get('r2')!.standings.map(s => [s.playerId, s.totalPoints, s.position]), [['b', 63, 1], ['a', 50, 2], ['c', 45, 3]])
  assert.equal(out.get('r2')!.roundsIncluded, 2)
  assert.deepEqual(out.get('r3')!.standings.map(s => [s.playerId, s.totalPoints, s.position]), [['a', 90, 1], ['b', 73, 2], ['c', 70, 3]])
})

test('ISSUE 6: a round that is not completed is never included and gets no entry', () => {
  const out = cumulativeThroughRounds(
    [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'active' }],
    new Map([['r1', [P('a', 30)]], ['r2', [P('a', 99)]]]),
  )
  assert.equal(out.has('r2'), false)
  assert.equal(out.get('r1')!.standings[0].totalPoints, 30)
})

test('ISSUE 6: Top 5 only, ties share a position', () => {
  const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const out = cumulativeThroughRounds([{ id: 'r1', status: 'completed' }], new Map([['r1', players.map((p, i) => P(p, 40 - i))]]))
  assert.equal(out.get('r1')!.standings.length, 5)
  const tied = cumulativeThroughRounds([{ id: 'r1', status: 'completed' }], new Map([['r1', [P('a', 30), P('b', 30), P('c', 20)]]]))
  assert.deepEqual(tied.get('r1')!.standings.map(s => s.position), [1, 1, 3])
})

function threeRoundData(): EventMemoryData {
  const s1 = [{ playerId: 'a', playerName: 'A', roundPoints: 30, position: 1 }]
  const mk = (id: string, ord: number, cumPts: number, included: number) => round({
    id, ordinal: ord, standings: s1, winners: [{ playerId: 'a', playerName: 'A', points: 30 }],
    cumulativeStandings: [{ playerId: 'a', playerName: 'A', totalPoints: cumPts, position: 1 }],
    cumulativeRoundsIncluded: included,
  })
  return data({ rounds: [mk('r1', 1, 30, 1), mk('r2', 2, 60, 2), mk('r3', 3, 90, 3)] })
}

test('ISSUE 6: Round 1 -> Results only; Round 2 -> Results then Total Scores; Round 3 -> Results then Total Scores', () => {
  const d = threeRoundData()
  const deck = buildPresentationDeck(d, fullConfig(d))
  const k = kinds(deck.slides)
  const rrIdx = k.map((x, i) => x === 'roundResults' ? i : -1).filter(i => i >= 0)
  assert.equal(rrIdx.length, 3)
  const cum = deck.slides.filter((s): s is Extract<Slide, { kind: 'cumulativeResults' }> => s.kind === 'cumulativeResults')
  assert.deepEqual(cum.map(c => [c.roundId, c.roundsIncluded]), [['r2', 2], ['r3', 3]])
  // directly after its own round's Results slide, never before / elsewhere
  assert.equal(k[rrIdx[0] + 1] === 'cumulativeResults', false, 'no cumulative slide after Round 1')
  assert.equal(k[rrIdx[1] + 1], 'cumulativeResults')
  assert.equal(k[rrIdx[2] + 1], 'cumulativeResults')
  assert.equal((deck.slides[rrIdx[1] + 1] as Extract<Slide, { kind: 'cumulativeResults' }>).roundId, 'r2')
})

test('ISSUE 6: the existing Round Results slide is unchanged (still this round\'s own points)', () => {
  const d = threeRoundData()
  const deck = buildPresentationDeck(d, fullConfig(d))
  const rr = deck.slides.filter((s): s is Extract<Slide, { kind: 'roundResults' }> => s.kind === 'roundResults')
  assert.deepEqual(rr.map(r => r.standings[0].roundPoints), [30, 30, 30])
})

test('ISSUE 6: Round Results switched off for a round -> no cumulative slide for it either; no data -> no slide (nothing invented)', () => {
  const d = threeRoundData()
  const cfg = fullConfig(d)
  cfg.rounds = cfg.rounds.map(r => r.roundId === 'r2' ? { ...r, roundResults: false } : r)
  const deck = buildPresentationDeck(d, cfg)
  const cum = deck.slides.filter((s): s is Extract<Slide, { kind: 'cumulativeResults' }> => s.kind === 'cumulativeResults')
  assert.deepEqual(cum.map(c => c.roundId), ['r3'])

  const d2 = data({ rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'a', playerName: 'A', points: 1 }], standings: [{ playerId: 'a', playerName: 'A', roundPoints: 1, position: 1 }] }), round({ id: 'r2', ordinal: 2, winners: [{ playerId: 'a', playerName: 'A', points: 1 }], standings: [{ playerId: 'a', playerName: 'A', roundPoints: 1, position: 1 }] })] })
  assert.equal(kinds(buildPresentationDeck(d2, fullConfig(d2)).slides).includes('cumulativeResults'), false)
})

test('ISSUE 6: final event leaderboard and champion slides are still produced after the rounds', () => {
  const d = threeRoundData()
  d.results = { champion: { champions: [{ playerId: 'a', playerName: 'A', totalPoints: 90 }], hasTie: false, standings: [{ playerId: 'a', playerName: 'A', totalPoints: 90, position: 1 }] } }
  const k = kinds(buildPresentationDeck(d, fullConfig(d)).slides)
  assert.ok(k.lastIndexOf('cumulativeResults') < k.indexOf('champion'))
  assert.ok(k.indexOf('champion') < k.indexOf('leaderboard'))
})

// ── static wiring checks (React shells cannot run in the sandbox) ───────
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

test('ISSUE 6 wiring: the player renders cumulativeResults (not the generic fallback), and eventMemoryData feeds it from the shared per-round results', () => {
  const player = src('src/components/memories/EventHighlightsPlayer.tsx')
  assert.match(player, /slide\.kind === 'cumulativeResults'/)
  const emd = src('src/lib/trips/eventMemoryData.ts')
  assert.match(emd, /cumulativeThroughRounds\(/)
  assert.match(emd, /cumulativeStandings:/)
})

test('ISSUE 2 wiring: controls start hidden; nothing reveals them on slide change or play/pause; tap, click and focus do', () => {
  const p = src('src/components/memories/EventHighlightsPlayer.tsx')
  assert.match(p, /const \[controlsVisible, setControlsVisible\] = useState\(false\)/)
  assert.doesNotMatch(p, /useEffect\(\(\) => \{ bumpControls\(\) \}, \[index/)
  const bump = p.slice(p.indexOf('const bumpControls'), p.indexOf('const bumpControls') + 400)
  assert.doesNotMatch(bump, /if \(playing\)/, 'auto-hide must not depend on playback state')
  assert.match(bump, /CONTROLS_IDLE_MS/)
  assert.match(p, /onClick=\{bumpControls\}/)
  assert.match(p, /onTouchStart=\{bumpControls\}/)
  assert.match(p, /onFocusCapture=\{bumpControls\}/)
  // keyboard navigation / space no longer reveal the overlay
  const keys = p.slice(p.indexOf("function onKey"), p.indexOf("function onKey") + 500)
  assert.doesNotMatch(keys, /bumpControls/)
  assert.match(keys, /Escape/)
  // the close button stays in the controls layer and Escape still exits
  assert.match(p, /onClick=\{onExit\}/)
})

// ── Confirmed NON-bug: Makers & Breakers appear once PUBLISHED ───────────
test('Makers & Breakers: unpublished -> not selectable; once published -> selectable and its cards play (publication workflow untouched)', () => {
  const mk = (published: unknown) => data({ rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: published })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const sec = (d: EventMemoryData) => getAvailableSections(d, { kind: 'fullEvent' }).find(x => x.type === 'MAKERS_BREAKERS')!
  assert.equal(sec(mk(null)).available, false)
  const published = [{ kind: 'maker', icon: 'x', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3' }]
  const d = mk(published)
  assert.equal(sec(d).available, true)
  const deck = buildPresentationDeck(d, fullConfig(d))
  assert.equal(deck.slides.filter(s => s.kind === 'makersBreakersCard').length, 1)
})
