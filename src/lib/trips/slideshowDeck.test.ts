import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSlideshowDeck, rebuildDeckFromOrder, photoMomentIdsInOrder, type Slide } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

function memory(overrides: Partial<EventMemoryData['memories'][number]> & { momentId: string }): EventMemoryData['memories'][number] {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerId: 'p1', playerName: null,
    capturedBy: null, capturedByName: null, caption: null,
    imagePath: 'trip/general/p1/1.jpg', imageUrl: 'https://signed.example/1.jpg', audience: 'everyone',
    createdAt: '2026-09-11T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null,
    ...overrides,
  }
}

function round(overrides: Partial<EventMemoryData['rounds'][number]> & { id: string; ordinal: number }): EventMemoryData['rounds'][number] {
  return { name: `Round ${overrides.ordinal}`, courseName: null, playDate: '2026-09-11', status: 'completed', holes: 18, publishedHighlights: null, ...overrides }
}

function baseData(overrides: Partial<EventMemoryData> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Darren\u2019s Golf Trip 2026', eventType: 'tournament', location: null, startDate: '2026-09-11', endDate: '2026-09-13', status: 'completed' },
    rounds: [], memories: [], sideGameWinners: [], playerCount: 4, results: { champion: null },
    ...overrides,
  }
}

function photoSlides(slides: Slide[]): Extract<Slide, { kind: 'photo' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo')
}

// -- source selection ---------------------------------------------------

test('favourites source: only organiserFavourite memories are included', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', organiserFavourite: true }), memory({ momentId: 'b', organiserFavourite: false })] })
  const deck = buildSlideshowDeck(data, 'favourites')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['a'])
  assert.equal(deck.memoryCount, 1)
})

test('all source: every memory is included regardless of favourite status', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', organiserFavourite: true }), memory({ momentId: 'b', organiserFavourite: false })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.memoryCount, 2)
})

test('selected source: only the explicitly given momentIds are included, and an id with no matching memory is silently ignored, never fabricated', () => {
  const data = baseData({ memories: [memory({ momentId: 'a' }), memory({ momentId: 'b' }), memory({ momentId: 'c' })] })
  const deck = buildSlideshowDeck(data, 'selected', ['a', 'c', 'does-not-exist'])
  assert.deepEqual(photoMomentIdsInOrder(deck), ['a', 'c'])
})

test('zero favourites: favourites source produces a valid deck with zero photo slides, just opening and closing', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', organiserFavourite: false })] })
  const deck = buildSlideshowDeck(data, 'favourites')
  assert.equal(photoSlides(deck.slides).length, 0)
  assert.equal(deck.slides[0].kind, 'opening')
  assert.equal(deck.slides[deck.slides.length - 1].kind, 'closing')
})

// -- structure / ordering -------------------------------------------------

test('opening slide always first, closing slide always last', () => {
  const data = baseData({ memories: [memory({ momentId: 'a' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.slides[0].kind, 'opening')
  assert.equal(deck.slides[deck.slides.length - 1].kind, 'closing')
})

test('event-level memories (roundId null) appear under an event divider, before any round divider', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [
      memory({ momentId: 'event-photo', roundId: null, createdAt: '2026-09-11T08:00:00Z' }),
      memory({ momentId: 'round-photo', roundId: 'r1', createdAt: '2026-09-11T09:00:00Z' }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const kinds = deck.slides.map(s => s.kind)
  assert.deepEqual(kinds, ['opening', 'eventDivider', 'photo', 'roundDivider', 'photo', 'closing'])
})

test('no event divider when there are zero event-level memories in the selected set', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.ok(!deck.slides.some(s => s.kind === 'eventDivider'))
})

test('a round with zero selected memories produces no divider at all -- no empty chapters', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [memory({ momentId: 'a', roundId: 'r1' })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const roundDividers = deck.slides.filter(s => s.kind === 'roundDivider')
  assert.equal(roundDividers.length, 1)
})

test('rounds appear in chronological ordinal order, not round id or creation order', () => {
  const data = baseData({
    rounds: [round({ id: 'r-late', ordinal: 2 }), round({ id: 'r-early', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r-late' }), memory({ momentId: 'b', roundId: 'r-early' })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const dividerRoundIds = deck.slides.filter((s): s is Extract<Slide, { kind: 'roundDivider' }> => s.kind === 'roundDivider').map(s => s.roundId)
  assert.deepEqual(dividerRoundIds, ['r-early', 'r-late'])
})

test('a one-round event produces exactly one round divider, never a hardcoded assumption of more', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.slides.filter(s => s.kind === 'roundDivider').length, 1)
})

test('a five-round event with memories in every round produces five round dividers, not a fixed three', () => {
  const rounds = [1, 2, 3, 4, 5].map(n => round({ id: `r${n}`, ordinal: n }))
  const memories = [1, 2, 3, 4, 5].map(n => memory({ momentId: `m${n}`, roundId: `r${n}` }))
  const deck = buildSlideshowDeck(baseData({ rounds, memories }), 'all')
  assert.equal(deck.slides.filter(s => s.kind === 'roundDivider').length, 5)
})

test('chronological ordering within a round uses createdAt, never hole number', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [
      memory({ momentId: 'late-low-hole', roundId: 'r1', holeNumber: 1, createdAt: '2026-09-11T12:00:00Z' }),
      memory({ momentId: 'early-high-hole', roundId: 'r1', holeNumber: 18, createdAt: '2026-09-11T08:00:00Z' }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['early-high-hole', 'late-low-hole'])
})

test('equal timestamps are broken deterministically by momentId, not left to an unstable sort', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'zebra', createdAt: '2026-09-11T10:00:00Z' }),
      memory({ momentId: 'alpha', createdAt: '2026-09-11T10:00:00Z' }),
    ],
  })
  const deck1 = buildSlideshowDeck(data, 'all')
  const deck2 = buildSlideshowDeck(data, 'all')
  assert.deepEqual(photoMomentIdsInOrder(deck1), ['alpha', 'zebra'])
  assert.deepEqual(photoMomentIdsInOrder(deck1), photoMomentIdsInOrder(deck2))
})

test('a single-memory slideshow still produces a complete opening -> memory -> closing deck', () => {
  const deck = buildSlideshowDeck(baseData({ memories: [memory({ momentId: 'only-one' })] }), 'all')
  assert.deepEqual(deck.slides.map(s => s.kind), ['opening', 'eventDivider', 'photo', 'closing'])
})

// -- context / metadata ---------------------------------------------------

test('Side Game context (custom name) is carried onto the photo slide verbatim, not recomputed', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', sourceType: 'SIDE_GAME', sideCompName: "Beat Daz's Drive", holeNumber: 7 })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const slide = photoSlides(deck.slides)[0]
  assert.equal(slide.sideCompName, "Beat Daz's Drive")
  assert.equal(slide.sourceType, 'SIDE_GAME')
})

test('an existing caption is carried through; a missing caption stays null, never fabricated', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', caption: 'Great shot!' }), memory({ momentId: 'b', caption: null })] })
  const deck = buildSlideshowDeck(data, 'all')
  const slides = photoSlides(deck.slides)
  assert.equal(slides.find(s => s.momentId === 'a')!.caption, 'Great shot!')
  assert.equal(slides.find(s => s.momentId === 'b')!.caption, null)
})

test('missing hole number and missing player name both stay null -- never a placeholder string', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', holeNumber: null, playerName: null })] })
  const deck = buildSlideshowDeck(data, 'all')
  const slide = photoSlides(deck.slides)[0]
  assert.equal(slide.holeNumber, null)
  assert.equal(slide.playerName, null)
})

test('Favourite status is carried onto the photo slide so the player can apply subtle treatment, without being required to', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', organiserFavourite: true })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(photoSlides(deck.slides)[0].organiserFavourite, true)
})

test('opening hero image is the first Favourite in chronological order when one exists, not an arbitrary or AI-chosen pick', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'a', createdAt: '2026-09-11T08:00:00Z', organiserFavourite: false, imageUrl: 'https://x/a.jpg' }),
      memory({ momentId: 'b', createdAt: '2026-09-11T09:00:00Z', organiserFavourite: true, imageUrl: 'https://x/b.jpg' }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const opening = deck.slides[0]
  assert.equal(opening.kind, 'opening')
  assert.equal((opening as Extract<Slide, { kind: 'opening' }>).heroImageUrl, 'https://x/b.jpg')
})

test('opening hero image is null (clean branding, no guess) when the selected set has no Favourite at all', () => {
  const data = baseData({ memories: [memory({ momentId: 'a', organiserFavourite: false })] })
  const deck = buildSlideshowDeck(data, 'all')
  const opening = deck.slides[0] as Extract<Slide, { kind: 'opening' }>
  assert.equal(opening.heroImageUrl, null)
})

// -- curation (reorder / remove / add) -------------------------------------

test('rebuildDeckFromOrder: a manually reordered id list changes photo order within a round, round grouping unaffected', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r1' })],
  })
  const deck = rebuildDeckFromOrder(data, ['b', 'a'])
  assert.deepEqual(photoMomentIdsInOrder(deck), ['b', 'a'])
})

test('rebuildDeckFromOrder: removing a Moment id drops it from the deck, and drops its round divider too if it was the only one', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r2' })],
  })
  const deck = rebuildDeckFromOrder(data, ['b']) // 'a' removed
  assert.deepEqual(photoMomentIdsInOrder(deck), ['b'])
  assert.equal(deck.slides.filter(s => s.kind === 'roundDivider').length, 1)
})

test('rebuildDeckFromOrder: adding back a previously-excluded Moment id restores it under its correct round divider', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r1' })],
  })
  const withoutB = rebuildDeckFromOrder(data, ['a'])
  assert.deepEqual(photoMomentIdsInOrder(withoutB), ['a'])
  const withBAddedBack = rebuildDeckFromOrder(data, ['a', 'b'])
  assert.deepEqual(photoMomentIdsInOrder(withBAddedBack), ['a', 'b'])
})

// -- realistic multi-round fixture, at scale -------------------------------

test('realistic fixture: 60 memories across 3 rounds plus event-level, with Side Games and favourites, builds a fully consistent deck', () => {
  const rounds = [1, 2, 3].map(n => round({ id: `r${n}`, ordinal: n, name: `Round ${n}`, courseName: n === 2 ? 'Pine Valley' : 'Eagle Ridge' }))
  const memories: EventMemoryData['memories'] = []
  let favourites = 0
  for (let i = 0; i < 6; i++) memories.push(memory({ momentId: `event-${i}`, roundId: null, createdAt: `2026-09-10T0${i}:00:00Z` }))
  for (let r = 1; r <= 3; r++) {
    for (let i = 0; i < 18; i++) {
      const id = `r${r}-${i}`
      const isFav = i % 5 === 0
      if (isFav) favourites += 1
      memories.push(memory({
        momentId: id, roundId: `r${r}`, holeNumber: (i % 18) + 1,
        createdAt: `2026-09-1${r}T${String(8 + Math.floor(i / 6)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
        organiserFavourite: isFav,
        sourceType: i % 4 === 0 ? 'SIDE_GAME' : 'GENERAL',
        sideCompName: i % 4 === 0 ? 'Longest Drive' : null,
      }))
    }
  }
  const data = baseData({ rounds, memories })

  const allDeck = buildSlideshowDeck(data, 'all')
  assert.equal(allDeck.memoryCount, memories.length)
  assert.equal(allDeck.slides.filter(s => s.kind === 'roundDivider').length, 3)
  assert.equal(allDeck.slides.filter(s => s.kind === 'eventDivider').length, 1)
  assert.equal(allDeck.slides[0].kind, 'opening')
  assert.equal(allDeck.slides[allDeck.slides.length - 1].kind, 'closing')
  // Every photo slide's round divider genuinely precedes it in the array.
  let currentRoundId: string | null = null
  for (const s of allDeck.slides) {
    if (s.kind === 'roundDivider') currentRoundId = s.roundId
    if (s.kind === 'photo' && s.roundName !== null) {
      assert.ok(currentRoundId !== null, `photo ${s.momentId} appeared before any round divider`)
    }
  }

  const favDeck = buildSlideshowDeck(data, 'favourites')
  assert.equal(favDeck.memoryCount, favourites)
})
