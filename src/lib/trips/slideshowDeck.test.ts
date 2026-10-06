import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSlideshowDeck, rebuildDeckFromOrder, photoMomentIdsInOrder, type Slide,
  buildPresentationDeck, getAvailableSections, defaultPresentationConfig,
  type PresentationConfig, type RoundSectionConfig,
} from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

function memory(overrides: Partial<EventMemoryData['memories'][number]> & { momentId: string }): EventMemoryData['memories'][number] {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerId: 'p1', playerName: null,
    capturedBy: null, capturedByName: null, caption: null,
    imagePath: 'trip/general/p1/1.jpg', imageUrl: 'https://signed.example/1.jpg', audience: 'everyone',
    createdAt: '2026-09-11T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null,
    mediaType: 'photo', durationSeconds: null, isBlooper: false,
    ...overrides,
  }
}

function round(overrides: Partial<EventMemoryData['rounds'][number]> & { id: string; ordinal: number }): EventMemoryData['rounds'][number] {
  return { name: `Round ${overrides.ordinal}`, courseName: null, playDate: '2026-09-11', status: 'completed', holes: 18, publishedHighlights: null, winners: null, ...overrides }
}

function baseData(overrides: Partial<EventMemoryData> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Darren\u2019s Golf Trip 2026', eventType: 'tournament', location: null, startDate: '2026-09-11', endDate: '2026-09-13', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [], memories: [], sideGameWinners: [], sideGameCount: 0, playerCount: 4, results: { champion: null },
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

// -- Event Memories V1.3 (13 Sep): Champion / Leaderboard / Side Game winner / Makers & Breakers --

function championSlides(slides: Slide[]): Extract<Slide, { kind: 'champion' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'champion' }> => s.kind === 'champion')
}
function leaderboardSlides(slides: Slide[]): Extract<Slide, { kind: 'leaderboard' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'leaderboard' }> => s.kind === 'leaderboard')
}
function winnerSlides(slides: Slide[]): Extract<Slide, { kind: 'sideGameWinner' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')
}
function makersBreakersSlides(slides: Slide[]): Extract<Slide, { kind: 'makersBreakersCard' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'makersBreakersCard' }> => s.kind === 'makersBreakersCard')
}

test('Champion present: a champion slide and at least one leaderboard slide appear when data.results.champion is set', () => {
  const data = baseData({
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides).length, 1)
  assert.equal(leaderboardSlides(deck.slides).length, 1)
})

test('Champion absent: no champion or leaderboard slide at all when data.results.champion is null -- never a guessed result', () => {
  const data = baseData({ results: { champion: null } })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides).length, 0)
  assert.equal(leaderboardSlides(deck.slides).length, 0)
})

test('Champion with Favourite photo: the champion photo is the matching player\'s Favourite image', () => {
  const data = baseData({
    memories: [memory({ momentId: 'a', playerId: 'p1', organiserFavourite: true, imageUrl: 'https://x/champ.jpg' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides)[0].photoUrl, 'https://x/champ.jpg')
})

test('Champion without photo: photoUrl is null, never guessed from an unrelated photo', () => {
  const data = baseData({
    memories: [memory({ momentId: 'a', playerId: 'someone-else', organiserFavourite: true, imageUrl: 'https://x/other.jpg' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides)[0].photoUrl, null)
})

test('Correct Champion photo selected deterministically: the EARLIEST chronological Favourite of the champion, not any Favourite of theirs', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'late', playerId: 'p1', organiserFavourite: true, imageUrl: 'https://x/late.jpg', createdAt: '2026-09-12T10:00:00Z' }),
      memory({ momentId: 'early', playerId: 'p1', organiserFavourite: true, imageUrl: 'https://x/early.jpg', createdAt: '2026-09-11T08:00:00Z' }),
    ],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides)[0].photoUrl, 'https://x/early.jpg')
})

test('Final leaderboard ordering: entries are ordered by authoritative position, read verbatim, never recomputed from Memory data', () => {
  const standings = [
    { playerId: 'p2', playerName: 'Second', totalPoints: 60, position: 2 },
    { playerId: 'p1', playerName: 'First', totalPoints: 72, position: 1 },
    { playerId: 'p3', playerName: 'Third', totalPoints: 55, position: 3 },
  ]
  const data = baseData({ results: { champion: { champions: [{ playerId: 'p1', playerName: 'First', totalPoints: 72 }], hasTie: false, standings } } })
  const deck = buildSlideshowDeck(data, 'all')
  const entries = leaderboardSlides(deck.slides)[0].entries
  assert.deepEqual(entries.map(e => e.position), [1, 2, 3])
})

test('V1.6: Final Leaderboard shows Top 5 only, as a single slide, never the full field or multiple pages', () => {
  const standings = Array.from({ length: 23 }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i}`, totalPoints: 100 - i, position: i + 1 }))
  const data = baseData({ results: { champion: { champions: [standings[0]], hasTie: false, standings } } })
  const deck = buildSlideshowDeck(data, 'all')
  const pages = leaderboardSlides(deck.slides)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].entries.length, 5)
  assert.deepEqual(pages[0].entries.map(e => e.position), [1, 2, 3, 4, 5])
  assert.equal(pages[0].totalPages, 1)
})

test('V1.6: a field smaller than 5 shows exactly however many players exist, never padded', () => {
  const standings = [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }, { playerId: 'p2', playerName: 'B', totalPoints: 68, position: 2 }]
  const data = baseData({ results: { champion: { champions: [standings[0]], hasTie: false, standings } } })
  const deck = buildSlideshowDeck(data, 'all')
  const pages = leaderboardSlides(deck.slides)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].entries.length, 2)
})

test('Round with Memories but no Side Games: no sideGameWinner slide appears for that round', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(winnerSlides(deck.slides).length, 0)
})

test('Side Game winner with matching Memory: the winner slide carries that Memory\'s imageUrl', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', playerId: 'winner-id', sourceType: 'SIDE_GAME', sideCompId: 'sc1', imageUrl: 'https://x/winner.jpg' })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'winner-id', winnerName: 'Alex Schaefer' }],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const winners = winnerSlides(deck.slides)
  assert.equal(winners.length, 1)
  assert.equal(winners[0].winnerImageUrl, 'https://x/winner.jpg')
  assert.equal(winners[0].winnerName, 'Alex Schaefer')
})

test('Side Game winner without a matching Memory: the slide still renders, with a null image, never fabricated', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'winner-id', winnerName: 'Alex Schaefer' }],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const winners = winnerSlides(deck.slides)
  assert.equal(winners.length, 1)
  assert.equal(winners[0].winnerImageUrl, null)
})

test('A Side Game Memory belonging to a NON-winner never becomes a winner slide -- the critical rule', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', playerId: 'not-the-winner', sourceType: 'SIDE_GAME', sideCompId: 'sc1' })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'actual-winner', winnerName: 'Alex Schaefer' }],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const winners = winnerSlides(deck.slides)
  assert.equal(winners.length, 1)
  // The winner slide's photo must NOT be the non-winner's Memory -- there is no match (different playerId).
  assert.equal(winners[0].winnerImageUrl, null)
})

test('An official winner with no official_winner_entry_id yet (no name/playerId) never produces a winner slide', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: null, winnerName: null }],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(winnerSlides(deck.slides).length, 0)
})

test('Makers & Breakers present: a published highlight for a round produces a divider plus one card with that content verbatim', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3 holes' }] })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.slides.filter(s => s.kind === 'makersBreakersDivider').length, 1)
  const mb = makersBreakersSlides(deck.slides)
  assert.equal(mb.length, 1)
  assert.equal(mb[0].highlight.title, 'Hot Start')
  assert.equal(mb[0].highlight.playerName, 'Alex Schaefer')
})

test('V1.6: multiple Makers & Breakers in one round each get their own full card, never crammed into one slide', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [
      { kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex', statLine: 'x' },
      { kind: 'breaker', icon: '\u2744\ufe0f', title: 'Ice Cold', playerName: 'Dave', statLine: 'y' },
      { kind: 'maker', icon: '\u{1F3AF}', title: 'Dead Eye', playerName: 'Mick', statLine: 'z' },
    ] })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const mb = makersBreakersSlides(deck.slides)
  assert.equal(mb.length, 3)
  assert.equal(deck.slides.filter(s => s.kind === 'makersBreakersDivider').length, 1)
})

test('V1.7 regression fix: Makers & Breakers never carries a photo, even when a matching photo genuinely exists -- photo matching was removed entirely per an explicit product correction', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [
      { kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'x' },
    ] })],
    memories: [memory({ momentId: 'a', roundId: 'r1', playerName: 'Alex Schaefer', imageUrl: 'https://x/alex.jpg' })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const mb = makersBreakersSlides(deck.slides)
  assert.equal(mb.length, 1)
  // No photoUrl field should exist on the card at all.
  assert.ok(!('photoUrl' in mb[0]))
})

test('Makers & Breakers absent: no slide appears for a round with no published highlights, never an empty slide', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: null })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(makersBreakersSlides(deck.slides).length, 0)
})

test('malformed published highlights data is parsed defensively -- never throws, never fabricates a highlight from garbage', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: 'not-an-array' })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  assert.doesNotThrow(() => buildSlideshowDeck(data, 'all'))
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(makersBreakersSlides(deck.slides).length, 0)
})

test('a round with zero Memories but a real Side Game winner still gets a round divider -- results do not depend on curated Memories', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w1', winnerName: 'Alex Schaefer' }],
  })
  const deck = buildSlideshowDeck(data, 'favourites') // favourites source -- zero favourites selected
  assert.equal(deck.slides.filter(s => s.kind === 'roundDivider').length, 1)
  assert.equal(winnerSlides(deck.slides).length, 1)
})

test('results do not depend upon Favourite status: the champion/leaderboard/winner slides are identical regardless of chosen source', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', organiserFavourite: false })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w1', winnerName: 'Alex Schaefer' }],
    results: { champion: { champions: [{ playerId: 'w1', playerName: 'Alex Schaefer', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'w1', playerName: 'Alex Schaefer', totalPoints: 72, position: 1 }] } },
  })
  const favDeck = buildSlideshowDeck(data, 'favourites')
  const allDeck = buildSlideshowDeck(data, 'all')
  assert.equal(winnerSlides(favDeck.slides).length, winnerSlides(allDeck.slides).length)
  assert.equal(championSlides(favDeck.slides).length, championSlides(allDeck.slides).length)
})

// -- V1.4 (14 Sep): group photo and Bloopers/Outtakes --------------------

function groupPhotoSlides(slides: Slide[]): Extract<Slide, { kind: 'groupPhoto' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'groupPhoto' }> => s.kind === 'groupPhoto')
}
function blooperSlides(slides: Slide[]): Extract<Slide, { kind: 'blooper' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'blooper' }> => s.kind === 'blooper')
}

test('group photo: an explicit selection that matches a real photo Memory produces a groupPhoto slide right after opening', () => {
  const data = baseData({ memories: [memory({ momentId: 'group-pic', imageUrl: 'https://x/group.jpg' })] })
  const deck = buildSlideshowDeck(data, 'all', undefined, 'group-pic')
  const kinds = deck.slides.map(s => s.kind)
  assert.deepEqual(kinds.slice(0, 2), ['opening', 'groupPhoto'])
  assert.equal(groupPhotoSlides(deck.slides)[0].imageUrl, 'https://x/group.jpg')
})

test('group photo: no selection produces no groupPhoto slide at all', () => {
  const data = baseData({ memories: [memory({ momentId: 'a' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(groupPhotoSlides(deck.slides).length, 0)
})

test('group photo: a selection that does not match any real Memory in this event is silently omitted, never fabricated', () => {
  const data = baseData({ memories: [memory({ momentId: 'a' })] })
  const deck = buildSlideshowDeck(data, 'all', undefined, 'does-not-exist')
  assert.equal(groupPhotoSlides(deck.slides).length, 0)
})

test('group photo: a selection pointing at a video Moment is rejected -- group photo must be a genuine photo', () => {
  const data = baseData({ memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 8 })] })
  const deck = buildSlideshowDeck(data, 'all', undefined, 'vid')
  assert.equal(groupPhotoSlides(deck.slides).length, 0)
})

test('text and video Moments never appear as regular photo slides, regardless of source', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'photo-1', mediaType: 'photo' }),
      memory({ momentId: 'text-1', mediaType: 'text', imageUrl: null, caption: 'Great round today' }),
      memory({ momentId: 'video-1', mediaType: 'video', durationSeconds: 9 }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['photo-1'])
})

test('Bloopers: only organiser-selected (isBlooper) Memories appear, in a dedicated chapter after a divider', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'vid-selected', mediaType: 'video', durationSeconds: 9, isBlooper: true, imageUrl: 'https://x/clip.mp4' }),
      memory({ momentId: 'vid-not-selected', mediaType: 'video', durationSeconds: 7, isBlooper: false }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const bloopers = blooperSlides(deck.slides)
  assert.equal(bloopers.length, 1)
  assert.equal(bloopers[0].momentId, 'vid-selected')
  assert.equal(bloopers[0].mediaType, 'video')
  assert.equal(bloopers[0].imageUrl, 'https://x/clip.mp4')
  assert.equal(bloopers[0].durationSeconds, 9)
  assert.ok(deck.slides.some(s => s.kind === 'bloopersDivider'))
})

test('V1.6: a photo Memory flagged isBlooper is now genuinely a valid Blooper, not excluded -- media type and classification are independent', () => {
  const data = baseData({
    memories: [memory({ momentId: 'photo-blooper', mediaType: 'photo', isBlooper: true, imageUrl: 'https://x/funny.jpg' })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const bloopers = blooperSlides(deck.slides)
  assert.equal(bloopers.length, 1)
  assert.equal(bloopers[0].mediaType, 'photo')
  assert.equal(bloopers[0].imageUrl, 'https://x/funny.jpg')
})

test('V1.6: a text Memory flagged isBlooper is still excluded -- it has no visual content for the Bloopers chapter', () => {
  const data = baseData({
    memories: [memory({ momentId: 'text-blooper', mediaType: 'text', imageUrl: null, caption: 'funny story', isBlooper: true })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(blooperSlides(deck.slides).length, 0)
})

test('Bloopers: V1.6 correction -- a flagged photo Moment is now genuinely included; a flagged text Moment is still excluded (no visual content)', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'photo-flagged', mediaType: 'photo', isBlooper: true, imageUrl: 'https://x/p.jpg' }),
      memory({ momentId: 'text-flagged', mediaType: 'text', imageUrl: null, caption: 'oops', isBlooper: true }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const bloopers = blooperSlides(deck.slides)
  assert.equal(bloopers.length, 1)
  assert.equal(bloopers[0].momentId, 'photo-flagged')
})

test('Bloopers: zero selected clips produces no Bloopers divider at all -- no empty chapter', () => {
  const data = baseData({ memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, isBlooper: false })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(blooperSlides(deck.slides).length, 0)
  assert.ok(!deck.slides.some(s => s.kind === 'bloopersDivider'))
})

test('Bloopers appear after the Champion/Leaderboard and before the closing slide', () => {
  const data = baseData({
    memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, isBlooper: true })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  const kinds = deck.slides.map(s => s.kind)
  const champIdx = kinds.indexOf('champion')
  const blooperDividerIdx = kinds.indexOf('bloopersDivider')
  const closingIdx = kinds.indexOf('closing')
  assert.ok(champIdx < blooperDividerIdx)
  assert.ok(blooperDividerIdx < closingIdx)
})

test('Bloopers source is independent of the chosen slideshow source (favourites/all/selected) and of Favourite status', () => {
  const data = baseData({ memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, isBlooper: true, organiserFavourite: false })] })
  const favDeck = buildSlideshowDeck(data, 'favourites')
  assert.equal(blooperSlides(favDeck.slides).length, 1)
})

test('Bloopers are chronologically ordered with a deterministic tie-break, same rule as photos', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'later', mediaType: 'video', durationSeconds: 5, isBlooper: true, createdAt: '2026-09-11T12:00:00Z' }),
      memory({ momentId: 'earlier', mediaType: 'video', durationSeconds: 5, isBlooper: true, createdAt: '2026-09-11T08:00:00Z' }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(blooperSlides(deck.slides).map(s => s.momentId), ['earlier', 'later'])
})

test('V1.5 fix: a winning photo appears exactly once (as the dedicated winner slide), never also as an ordinary photo slide in the same round', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [
      memory({ momentId: 'winner-photo', roundId: 'r1', playerId: 'winner-id', sourceType: 'SIDE_GAME', sideCompId: 'sc1', imageUrl: 'https://x/winner.jpg' }),
      memory({ momentId: 'other-photo', roundId: 'r1', playerId: 'someone-else' }),
    ],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'winner-id', winnerName: 'Alex Schaefer' }],
  })
  const deck = buildSlideshowDeck(data, 'all')
  // The winner photo must appear exactly once in the deck overall --
  // not as a photo slide AND as the winner slide's own image.
  const occurrencesOfWinnerPhoto = deck.slides.filter(s =>
    (s.kind === 'photo' && s.momentId === 'winner-photo') ||
    (s.kind === 'sideGameWinner' && s.winnerImageUrl === 'https://x/winner.jpg')
  )
  assert.equal(occurrencesOfWinnerPhoto.length, 1)
  assert.equal(occurrencesOfWinnerPhoto[0].kind, 'sideGameWinner')
  // The ordinary photo stream must still include the OTHER photo --
  // the fix excludes only the specific winning photo, not every
  // Side-Game-sourced photo in the round.
  assert.deepEqual(photoMomentIdsInOrder(deck), ['other-photo'])
  // Exactly one sideGameWinner slide, not two.
  assert.equal(deck.slides.filter(s => s.kind === 'sideGameWinner').length, 1)
})

test('no duplicate Champion/leaderboard slides -- exactly one champion slide even with multiple co-champions (a tie)', () => {
  const data = baseData({
    results: {
      champion: {
        champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }, { playerId: 'p2', playerName: 'B', totalPoints: 72 }],
        hasTie: true,
        standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }, { playerId: 'p2', playerName: 'B', totalPoints: 72, position: 1 }],
      },
    },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlides(deck.slides).length, 1)
  assert.equal(championSlides(deck.slides)[0].hasTie, true)
  assert.equal(championSlides(deck.slides)[0].champions.length, 2)
})

// -- V1.5 (15 Sep): flexible section-based presentation builder ----------

function roundSlides(slides: Slide[]): Extract<Slide, { kind: 'roundDivider' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'roundDivider' }> => s.kind === 'roundDivider')
}

test('Round-only presentation: a single-round config produces exactly that round\'s content and nothing from Event-level sections', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', organiserFavourite: true })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(roundSlides(deck.slides).length, 1)
  assert.equal(deck.slides.filter(s => s.kind === 'opening').length, 0)
  assert.equal(deck.slides.filter(s => s.kind === 'champion').length, 0)
  assert.equal(deck.slides.filter(s => s.kind === 'closing').length, 0)
  assert.deepEqual(photoMomentIdsInOrder(deck), ['a'])
})

test('Full Event presentation: multiple rounds, Champion, Leaderboard, and closing all appear when toggled on', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', organiserFavourite: true }), memory({ momentId: 'b', roundId: 'r2', organiserFavourite: true })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: true, groupPhoto: false,
    rounds: [
      { roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false },
      { roundId: 'r2', bestMoments: true, sideGameWinners: false, makersBreakers: false },
    ],
    eventChampion: true, finalLeaderboard: true, bloopers: false, eventFinale: true,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(deck.slides[0].kind, 'opening')
  assert.equal(roundSlides(deck.slides).length, 2)
  assert.equal(deck.slides.filter(s => s.kind === 'champion').length, 1)
  assert.equal(deck.slides.filter(s => s.kind === 'leaderboard').length, 1)
  assert.equal(deck.slides[deck.slides.length - 1].kind, 'closing')
})

test('Different section selections: turning a section off genuinely omits it, even when the underlying data exists', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex', statLine: 'Birdied 3 in a row' }] })],
    memories: [memory({ momentId: 'a', roundId: 'r1' })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w1', winnerName: 'Dave' }],
  })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: true }], // only Makers & Breakers on
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'all',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(photoMomentIdsInOrder(deck).length, 0) // Best Moments off -- 'a' never appears
  assert.equal(deck.slides.filter(s => s.kind === 'sideGameWinner').length, 0) // Side Game Winners off
  assert.equal(deck.slides.filter(s => s.kind === 'makersBreakersCard').length, 1) // Makers & Breakers on
})

test('Three-round and non-three-round events: defaultPresentationConfig produces the correct round count for 1 and 5 rounds, never assuming 3', () => {
  const oneRound = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const oneConfig = defaultPresentationConfig(oneRound, { kind: 'fullEvent' })
  assert.equal(oneConfig.rounds.length, 1)

  const fiveRounds = baseData({
    rounds: [1, 2, 3, 4, 5].map(n => round({ id: `r${n}`, ordinal: n })),
    memories: [1, 2, 3, 4, 5].map(n => memory({ momentId: `m${n}`, roundId: `r${n}` })),
  })
  const fiveConfig = defaultPresentationConfig(fiveRounds, { kind: 'fullEvent' })
  assert.equal(fiveConfig.rounds.length, 5)
})

test('Final round retained before Event Champion: the last round\'s own section still appears even when Event Champion is also included', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [memory({ momentId: 'a', roundId: 'r2', organiserFavourite: true })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r2', bestMoments: true, sideGameWinners: false, makersBreakers: false }],
    eventChampion: true, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  const roundDividerIdx = deck.slides.findIndex(s => s.kind === 'roundDivider')
  const championIdx = deck.slides.findIndex(s => s.kind === 'champion')
  assert.ok(roundDividerIdx > -1, 'the final round section must still appear')
  assert.ok(roundDividerIdx < championIdx, 'the round section must come before Event Champion, not be replaced by it')
})

test('Event Champion can genuinely differ from the final round\'s own Side Game winner -- never assumed to be the same player', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'round-winner-id', winnerName: 'Dave' }],
    results: { champion: { champions: [{ playerId: 'champion-id', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'champion-id', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: true, makersBreakers: false }],
    eventChampion: true, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  const winnerSlide = deck.slides.find((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')!
  const champSlide = deck.slides.find((s): s is Extract<Slide, { kind: 'champion' }> => s.kind === 'champion')!
  assert.equal(winnerSlide.winnerName, 'Dave')
  assert.equal(champSlide.champions[0].playerName, 'Alex')
})

test('V1.5: no empty section dividers -- a round with every section toggled on but zero real content for any of them produces no section at all', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: true, makersBreakers: true }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'all',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(deck.slides.length, 0)
})

test('General Moments are correctly filtered by Favourites when bestMomentsSource is favourites, and by an explicit selection when selected', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'fav', roundId: 'r1', organiserFavourite: true }), memory({ momentId: 'not-fav', roundId: 'r1', organiserFavourite: false })],
  })
  const favConfig: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false,
    bestMomentsSource: 'favourites',
  }
  assert.deepEqual(photoMomentIdsInOrder(buildPresentationDeck(data, favConfig)), ['fav'])

  const selectedConfig: PresentationConfig = { ...favConfig, bestMomentsSource: 'selected', selectedMomentIds: ['not-fav'] }
  assert.deepEqual(photoMomentIdsInOrder(buildPresentationDeck(data, selectedConfig)), ['not-fav'])
})

test('Group photo present/absent in the new builder: present when toggled on and genuinely selected, absent when off or unselected', () => {
  const dataWithSelection = baseData({ event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null }, memories: [memory({ momentId: 'gp', imageUrl: 'https://x/gp.jpg' })] })
  const onConfig: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: true, rounds: [],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deckOn = buildPresentationDeck(dataWithSelection, onConfig)
  assert.equal(deckOn.slides.filter(s => s.kind === 'groupPhoto').length, 1)

  const offConfig: PresentationConfig = { ...onConfig, groupPhoto: false }
  const deckOff = buildPresentationDeck(dataWithSelection, offConfig)
  assert.equal(deckOff.slides.filter(s => s.kind === 'groupPhoto').length, 0)
})

test('Bloopers present/absent in the new builder, matching the existing toggle semantics', () => {
  const data = baseData({ memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const onConfig: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: false, bloopers: true, eventFinale: false, bestMomentsSource: 'favourites',
  }
  assert.equal(buildPresentationDeck(data, onConfig).slides.filter(s => s.kind === 'blooper').length, 1)
  const offConfig: PresentationConfig = { ...onConfig, bloopers: false }
  assert.equal(buildPresentationDeck(data, offConfig).slides.filter(s => s.kind === 'blooper').length, 0)
})

test('V1.6: Top 5 only is preserved in the new builder for a large field', () => {
  const standings = Array.from({ length: 23 }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i}`, totalPoints: 100 - i, position: i + 1 }))
  const data = baseData({ results: { champion: { champions: [standings[0]], hasTie: false, standings } } })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: true, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  const pages = deck.slides.filter((s): s is Extract<Slide, { kind: 'leaderboard' }> => s.kind === 'leaderboard')
  assert.equal(pages.length, 1)
  assert.equal(pages[0].entries.length, 5)
})

test('A small field produces exactly one leaderboard slide, not an unnecessary extra page', () => {
  const standings = [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }, { playerId: 'p2', playerName: 'B', totalPoints: 68, position: 2 }]
  const data = baseData({ results: { champion: { champions: [standings[0]], hasTie: false, standings } } })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: true, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(deck.slides.filter(s => s.kind === 'leaderboard').length, 1)
})

test('getAvailableSections: a round section is marked unavailable with a reason when there is genuinely no content for it', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [] })
  const avail = getAvailableSections(data, { kind: 'round', roundId: 'r1' })
  const bestMoments = avail.find(a => a.type === 'BEST_MOMENTS')!
  assert.equal(bestMoments.available, false)
  assert.ok(bestMoments.reason)
})

test('getAvailableSections: a round section is marked available once real content exists', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const avail = getAvailableSections(data, { kind: 'round', roundId: 'r1' })
  assert.equal(avail.find(a => a.type === 'BEST_MOMENTS')!.available, true)
})

test('V1.7 regression fix: defaultPresentationConfig for Full Event -- every round with genuine Side Game Winners/Makers & Breakers defaults ON for that round specifically, including rounds before the final one', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot', playerName: 'A', statLine: 'x' }] }), round({ id: 'r2', ordinal: 2, publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot', playerName: 'A', statLine: 'x' }] })],
    memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r2' })],
    sideGameWinners: [
      { sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w1', winnerName: 'Dave' },
      { sideCompId: 'sc2', roundId: 'r2', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w2', winnerName: 'Mick' },
    ],
  })
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  const r1 = config.rounds.find(r => r.roundId === 'r1')!
  const r2 = config.rounds.find(r => r.roundId === 'r2')!
  assert.equal(r1.bestMoments, true)
  assert.equal(r1.sideGameWinners, true) // now defaults ON -- Round 1 genuinely has a winner
  assert.equal(r1.makersBreakers, true) // now defaults ON -- Round 1 genuinely has published highlights
  assert.equal(r2.bestMoments, true)
  assert.equal(r2.sideGameWinners, true)
  assert.equal(r2.makersBreakers, true)
})

test('defaultPresentationConfig for Round scope: Round Intro/Best Moments/Side Game Winners/Makers & Breakers are each defaulted on only where data genuinely exists', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] }) // no winners, no M&B
  const config = defaultPresentationConfig(data, { kind: 'round', roundId: 'r1' })
  const r1 = config.rounds[0]
  assert.equal(r1.bestMoments, true) // photos exist
  assert.equal(r1.sideGameWinners, false) // no winners exist
  assert.equal(r1.makersBreakers, false) // no M&B exist
})

test('malformed/missing round in a saved config is silently skipped, never fabricated or thrown', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'does-not-exist', bestMoments: true, sideGameWinners: false, makersBreakers: false } as RoundSectionConfig],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  assert.doesNotThrow(() => buildPresentationDeck(data, config))
  assert.equal(buildPresentationDeck(data, config).slides.length, 0)
})

test('existing V1.4 slideshow behaviour (buildSlideshowDeck) is not regressed by the new builder\'s addition', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.ok(deck.slides.length > 0)
  assert.equal(deck.slides[0].kind, 'opening')
})

// -- V1.5 completion patch (15 Sep): Round Winner, derived not stored --

test('Round Winner: a completed round with real winners produces a roundResults slide when toggled on', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }] })],
    memories: [],
  })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: true }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  const deck = buildPresentationDeck(data, config)
  const slide = deck.slides.find((s): s is Extract<Slide, { kind: 'roundResults' }> => s.kind === 'roundResults')
  assert.ok(slide)
  assert.equal(slide!.winners[0].playerName, 'Alex')
})

test('Round Winner: toggled off produces no roundResults slide even though the round has real winners', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }] })], memories: [] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  assert.equal(buildPresentationDeck(data, config).slides.filter(s => s.kind === 'roundResults').length, 0)
})

test('Round Winner: a round not yet completed (winners: null) never produces a roundResults slide, even when toggled on', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, status: 'active', winners: null })], memories: [] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: true }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  assert.equal(buildPresentationDeck(data, config).slides.filter(s => s.kind === 'roundResults').length, 0)
})

test('Round Winner: a tie is represented honestly -- every tied player appears, never one picked arbitrarily', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }, { playerId: 'p2', playerName: 'Dave', points: 38 }] })], memories: [] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: true }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  const slide = buildPresentationDeck(data, config).slides.find((s): s is Extract<Slide, { kind: 'roundResults' }> => s.kind === 'roundResults')!
  assert.equal(slide.winners.length, 2)
})

test('Round Winner never gets confused with Event Champion -- both can appear, naming different players, in the same deck', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'round-winner', playerName: 'Dave', points: 38 }] })],
    results: { champion: { champions: [{ playerId: 'event-champion', playerName: 'Alex', totalPoints: 150 }], hasTie: false, standings: [{ playerId: 'event-champion', playerName: 'Alex', totalPoints: 150, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: true }],
    eventChampion: true, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  const roundSlide = deck.slides.find((s): s is Extract<Slide, { kind: 'roundResults' }> => s.kind === 'roundResults')!
  const champSlide = deck.slides.find((s): s is Extract<Slide, { kind: 'champion' }> => s.kind === 'champion')!
  assert.equal(roundSlide.winners[0].playerName, 'Dave')
  assert.equal(champSlide.champions[0].playerName, 'Alex')
})

test('getAvailableSections: ROUND_RESULTS is unavailable with a reason for an incomplete round, available once winners exist', () => {
  const incomplete = baseData({ rounds: [round({ id: 'r1', ordinal: 1, status: 'active', winners: null })] })
  const avail1 = getAvailableSections(incomplete, { kind: 'round', roundId: 'r1' })
  const rr1 = avail1.find(a => a.type === 'ROUND_RESULTS')!
  assert.equal(rr1.available, false)
  assert.ok(rr1.reason)

  const complete = baseData({ rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }] })] })
  const avail2 = getAvailableSections(complete, { kind: 'round', roundId: 'r1' })
  assert.equal(avail2.find(a => a.type === 'ROUND_RESULTS')!.available, true)
})

test('V1.7 regression fix: defaultPresentationConfig -- every round\'s Round Winner/Side Games/Makers & Breakers defaults ON independently whenever genuinely available, not just the final round', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }], publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot', playerName: 'Alex', statLine: 'x' }] }),
      round({ id: 'r2', ordinal: 2, winners: [{ playerId: 'p2', playerName: 'Dave', points: 40 }] }),
    ],
    memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r2' })],
    sideGameWinners: [
      { sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'w1', winnerName: 'Mick' },
    ],
  })
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  const r1 = config.rounds.find(r => r.roundId === 'r1')!
  const r2 = config.rounds.find(r => r.roundId === 'r2')!
  // Round 1 (NOT the final round) genuinely has winners, a Side Game
  // winner, and published highlights -- all three must now default
  // ON, exactly matching the live-tested regression this fix addresses.
  assert.equal(r1.roundResults, true)
  assert.equal(r1.sideGameWinners, true)
  assert.equal(r1.makersBreakers, true)
  // Round 2 (the final round) has a Round Winner but no Side Game
  // winner and no published highlights for it specifically -- each
  // toggle is independently correct for what that round actually has.
  assert.equal(r2.roundResults, true)
  assert.equal(r2.sideGameWinners, false)
  assert.equal(r2.makersBreakers, false)
})

// -- V1.6 (5 Oct): Champion Photo fallback chain --------------------------

function championSlide(slides: Slide[]) {
  return slides.find((s): s is Extract<Slide, { kind: 'champion' }> => s.kind === 'champion')
}

test('Champion Photo: an explicit selection always wins, even when a Favourite and a Group Photo both also exist', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: 'cp' },
    memories: [
      memory({ momentId: 'cp', mediaType: 'photo', imageUrl: 'https://x/explicit.jpg' }),
      memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg' }),
      memory({ momentId: 'fav', mediaType: 'photo', imageUrl: 'https://x/fav.jpg', organiserFavourite: true, playerId: 'p1' }),
    ],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, 'https://x/explicit.jpg')
})

test('Champion Photo: with no explicit selection, falls back to a Favourite photo of the champion', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null },
    memories: [
      memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg' }),
      memory({ momentId: 'fav', mediaType: 'photo', imageUrl: 'https://x/fav.jpg', organiserFavourite: true, playerId: 'p1' }),
    ],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, 'https://x/fav.jpg')
})

test('Champion Photo: with no explicit selection and no Favourite of the champion, falls back to the Group Photo', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null },
    memories: [memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, 'https://x/group.jpg')
})

test('Champion Photo: with nothing suitable available at all, the champion card has no photo -- never fabricated', () => {
  const data = baseData({
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, null)
})

test('Champion Photo: an explicit selection pointing at a non-photo Moment is rejected, falling through the chain honestly', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: 'vid' },
    memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, imageUrl: 'https://x/clip.mp4' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, null)
})

test('Champion Photo fallback chain also works correctly in the new buildPresentationDeck builder', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null },
    memories: [memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, groupPhoto: false, rounds: [],
    eventChampion: true, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(championSlide(deck.slides)?.photoUrl, 'https://x/group.jpg')
})

// -- V1.7 (6 Oct): Event-at-a-Glance ---------------------------------------

function glanceSlide(slides: Slide[]) {
  return slides.find((s): s is Extract<Slide, { kind: 'eventAtAGlance' }> => s.kind === 'eventAtAGlance')
}

function fullEventConfig(overrides: Partial<PresentationConfig> = {}): PresentationConfig {
  return {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: true, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
    ...overrides,
  }
}

test('Event-at-a-Glance: a single round shows 1 Round, its own course name, its own hole count', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, holes: 18, courseName: 'Pine Valley' })] })
  const deck = buildPresentationDeck(data, fullEventConfig())
  const slide = glanceSlide(deck.slides)!
  assert.equal(slide.roundCount, 1)
  assert.deepEqual(slide.courseNames, ['Pine Valley'])
  assert.equal(slide.totalHoles, 18)
})

test('Event-at-a-Glance: three rounds sums holes correctly and lists course names in chronological round order, not insertion order', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r3', ordinal: 3, holes: 18, courseName: 'Third Course' }),
      round({ id: 'r1', ordinal: 1, holes: 18, courseName: 'First Course' }),
      round({ id: 'r2', ordinal: 2, holes: 9, courseName: 'Second Course' }),
    ],
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  const slide = glanceSlide(deck.slides)!
  assert.equal(slide.roundCount, 3)
  assert.equal(slide.totalHoles, 45)
  assert.deepEqual(slide.courseNames, ['First Course', 'Second Course', 'Third Course'])
})

test('Event-at-a-Glance: a round with no course name set is simply omitted from the list, never shown as a blank entry', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, holes: 18, courseName: 'Real Course' }), round({ id: 'r2', ordinal: 2, holes: 18, courseName: null })],
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  const slide = glanceSlide(deck.slides)!
  assert.deepEqual(slide.courseNames, ['Real Course'])
})

test('Event-at-a-Glance: sideGameCount reflects every Side Game configured, not just those with a declared winner', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], sideGameCount: 3, sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex' }] })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.sideGameCount, 3)
})

test('Event-at-a-Glance: zero Side Games is represented honestly as 0, never omitted or fabricated', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], sideGameCount: 0 })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.sideGameCount, 0)
})

test('Event-at-a-Glance: toggled off produces no slide at all, even with rounds present', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })] })
  const deck = buildPresentationDeck(data, fullEventConfig({ eventAtAGlance: false }))
  assert.equal(glanceSlide(deck.slides), undefined)
})

test('Event-at-a-Glance: no rounds at all produces no slide, never a zero-rounds card', () => {
  const data = baseData({ rounds: [] })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides), undefined)
})

test('defaultPresentationConfig: Event-at-a-Glance defaults ON for Full Event whenever rounds exist', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })] })
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  assert.equal(config.eventAtAGlance, true)
})

test('getAvailableSections: EVENT_AT_A_GLANCE is unavailable with a reason when there are no rounds yet', () => {
  const data = baseData({ rounds: [] })
  const avail = getAvailableSections(data, { kind: 'fullEvent' })
  const entry = avail.find(a => a.type === 'EVENT_AT_A_GLANCE')!
  assert.equal(entry.available, false)
  assert.ok(entry.reason)
})
