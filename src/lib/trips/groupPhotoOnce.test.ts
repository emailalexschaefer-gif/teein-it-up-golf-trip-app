import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPresentationDeck, buildSlideshowDeck, defaultPresentationConfig, type PresentationConfig, type Slide } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

type Mem = EventMemoryData['memories'][number]
function memory(o: Partial<Mem> & { momentId: string }): Mem {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerId: 'p1', playerName: null, capturedBy: null, capturedByName: null, caption: null,
    imagePath: 'x.jpg', imageUrl: `https://signed.example/${o.momentId}.jpg`, audience: 'everyone', createdAt: '2026-10-24T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null, mediaType: 'photo', durationSeconds: null, isBlooper: false, aftershowIncluded: null, ...o,
  }
}
const round = { id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18, publishedHighlights: null, winners: null, standings: null, cumulativeStandings: null, cumulativeRoundsIncluded: null } as EventMemoryData['rounds'][number]
function data(memories: Mem[], groupPhotoMomentId: string | null): EventMemoryData {
  return {
    event: { id: 't1', name: 'Lappen', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-25', status: 'completed', groupPhotoMomentId, championPhotoMomentId: null } as EventMemoryData['event'],
    rounds: [round], memories, sideGameWinners: [], sideGameCount: 0, playerCount: 4, results: { champion: null },
  } as EventMemoryData
}
const count = (slides: Slide[], id: string) => slides.filter(s => (s.kind === 'photo' || s.kind === 'groupPhoto') && s.momentId === id).length
const cfg = (d: EventMemoryData): PresentationConfig => ({ ...defaultPresentationConfig(d, { kind: 'fullEvent' }), bestMomentsSource: 'all' })

test('group photo that is a ROUND moment appears once (own slide), not again in the round', () => {
  const d = data([memory({ momentId: 'g', roundId: 'r1' }), memory({ momentId: 'a', roundId: 'r1' })], 'g')
  const deck = buildPresentationDeck(d, cfg(d))
  assert.equal(count(deck.slides, 'g'), 1); assert.equal(count(deck.slides, 'a'), 1)
  assert.ok(deck.slides.some(s => s.kind === 'groupPhoto'))
})
test('group photo that is an EVENT-LEVEL moment appears once', () => {
  const d = data([memory({ momentId: 'g', roundId: null }), memory({ momentId: 'e', roundId: null })], 'g')
  assert.equal(count(buildPresentationDeck(d, cfg(d)).slides, 'g'), 1)
})
test('group photo is not repeated in the aftershow (unassigned event upload is auto-suggested there)', () => {
  const d = data([memory({ momentId: 'g', roundId: null, playerId: null }), memory({ momentId: 'b', roundId: 'r1', isBlooper: true })], 'g')
  const deck = buildPresentationDeck(d, { ...cfg(d), bloopers: true })
  const all = deck.slides.filter(s => (s as { momentId?: string }).momentId === 'g')
  assert.equal(all.length, 1)
})
test('legacy builder: appears once too', () => {
  const d = data([memory({ momentId: 'g', roundId: 'r1' }), memory({ momentId: 'a', roundId: 'r1' })], 'g')
  const deck = buildSlideshowDeck(d, 'allMemories' as never, undefined, 'g')
  assert.equal(count(deck.slides, 'g'), 1); assert.equal(count(deck.slides, 'a'), 1)
})
test('with the Group Photo slide switched off, the Moment is not lost (it is an ordinary Moment again)', () => {
  const d = data([memory({ momentId: 'g', roundId: 'r1' })], 'g')
  const deck = buildPresentationDeck(d, { ...cfg(d), groupPhoto: false })
  assert.equal(count(deck.slides, 'g'), 1)
})
test('no selected group photo: nothing is excluded', () => {
  const d = data([memory({ momentId: 'a', roundId: 'r1' })], null)
  assert.equal(count(buildPresentationDeck(d, cfg(d)).slides, 'a'), 1)
})
test('the Moment itself is untouched in the data (Event Memories keep it)', () => {
  const d = data([memory({ momentId: 'g', roundId: 'r1' })], 'g')
  buildPresentationDeck(d, cfg(d))
  assert.equal(d.memories.length, 1)
})
