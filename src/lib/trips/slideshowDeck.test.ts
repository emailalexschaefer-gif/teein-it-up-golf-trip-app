import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSlideshowDeck, rebuildDeckFromOrder, photoMomentIdsInOrder, type Slide,
  buildPresentationDeck, getAvailableSections, defaultPresentationConfig, resolveSelectedMomentIds, resolveAftershowMomentIds,
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
    mediaType: 'photo', durationSeconds: null, isBlooper: false, aftershowIncluded: null,
    ...overrides,
  }
}

function round(overrides: Partial<EventMemoryData['rounds'][number]> & { id: string; ordinal: number }): EventMemoryData['rounds'][number] {
  return { name: `Round ${overrides.ordinal}`, courseName: null, playDate: '2026-09-11', status: 'completed', holes: 18, publishedHighlights: null, winners: null, standings: null, ...overrides }
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

test('V1.18 (Package 5): the Moments & Bloopers aftershow appears after the Champion/Leaderboard AND after the closing slide -- the formal presentation (ending on the closing screen) plays once, then the aftershow follows it, not the other way around', () => {
  const data = baseData({
    memories: [memory({ momentId: 'vid', mediaType: 'video', durationSeconds: 5, isBlooper: true })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'A', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'A', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  const kinds = deck.slides.map(s => s.kind)
  const champIdx = kinds.indexOf('champion')
  const closingIdx = kinds.indexOf('closing')
  const blooperDividerIdx = kinds.indexOf('bloopersDivider')
  assert.ok(champIdx < closingIdx)
  assert.ok(closingIdx < blooperDividerIdx)
  // The deck also reports where the aftershow starts, for the player's
  // own looping logic.
  assert.equal(deck.aftershowStartIndex, blooperDividerIdx)
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

test('V1.14: Round Results -- a completed round with real standings produces a roundResults slide when toggled on, position 1 is the round winner', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }], standings: [{ playerId: 'p1', playerName: 'Alex', roundPoints: 38, position: 1 }, { playerId: 'p2', playerName: 'Dave', roundPoints: 30, position: 2 }] })],
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
  assert.equal(slide!.standings[0].playerName, 'Alex')
  assert.equal(slide!.standings[0].position, 1)
  assert.equal(slide!.standings.length, 2)
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

test('V1.14: Round Results -- a tie at position 1 is represented honestly, both sharing position 1, never one picked arbitrarily', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'p1', playerName: 'Alex', points: 38 }, { playerId: 'p2', playerName: 'Dave', points: 38 }], standings: [{ playerId: 'p1', playerName: 'Alex', roundPoints: 38, position: 1 }, { playerId: 'p2', playerName: 'Dave', roundPoints: 38, position: 1 }] })],
    memories: [],
  })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: true }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  const slide = buildPresentationDeck(data, config).slides.find((s): s is Extract<Slide, { kind: 'roundResults' }> => s.kind === 'roundResults')!
  assert.equal(slide.standings.length, 2)
  assert.ok(slide.standings.every(s => s.position === 1))
})

test('V1.14: Round Results never gets confused with Event Champion -- a round\'s own Top-5 can name a different #1 than the cumulative Final Leaderboard, in the same deck', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, winners: [{ playerId: 'round-winner', playerName: 'Dave', points: 38 }], standings: [{ playerId: 'round-winner', playerName: 'Dave', roundPoints: 38, position: 1 }] })],
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
  assert.equal(roundSlide.standings[0].playerName, 'Dave')
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

test('V1.14 regression: Champion Photo no longer automatically falls back to the Group Photo -- real-device bug fix: the Champion slide was silently reusing the exact same image already shown as its own dedicated Group Photo slide earlier in the deck', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null },
    memories: [memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg' })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(championSlide(deck.slides)?.photoUrl, null)
})

test('V1.14: the Group Photo Moment CAN still legitimately appear as the Champion photo if the organiser explicitly marks it a Favourite of the champion -- that is a deliberate choice, not automatic duplication', () => {
  const data = baseData({
    event: { id: 't1', name: 'Event', eventType: null, location: null, startDate: null, endDate: null, status: 'completed', groupPhotoMomentId: 'gp', championPhotoMomentId: null },
    memories: [memory({ momentId: 'gp', mediaType: 'photo', imageUrl: 'https://x/group.jpg', organiserFavourite: true, playerId: 'p1' })],
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

test('V1.14 regression: the Group-Photo-removal fix applies identically in buildPresentationDeck', () => {
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
  assert.equal(championSlide(deck.slides)?.photoUrl, null)
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

// -- V1.17 (10 Oct): Event-at-a-Glance final backdrop + live championCount --

test('Event-at-a-Glance: three 9-hole rounds sum to 27 holes, not assumed 18-hole rounds -- the brief\'s own worked example', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r1', ordinal: 1, holes: 9, courseName: "St. John's" }),
      round({ id: 'r2', ordinal: 2, holes: 9, courseName: 'Champions' }),
      round({ id: 'r3', ordinal: 3, holes: 9, courseName: 'North' }),
    ],
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  const slide = glanceSlide(deck.slides)!
  assert.equal(slide.roundCount, 3)
  assert.equal(slide.totalHoles, 27)
  assert.deepEqual(slide.courseNames, ["St. John's", 'Champions', 'North'])
})

test('Event-at-a-Glance: three 18-hole rounds sum to 54 holes -- the canonical round-hole configuration is used, never inferred from score entries', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r1', ordinal: 1, holes: 18 }),
      round({ id: 'r2', ordinal: 2, holes: 18 }),
      round({ id: 'r3', ordinal: 3, holes: 18 }),
    ],
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.totalHoles, 54)
})

test('Event-at-a-Glance: 5 configured Side Games produce a count of 5, matching the brief\'s own regression-check expectation', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], sideGameCount: 5 })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.sideGameCount, 5)
})

test('Event-at-a-Glance: championCount is 0 for an event with no confirmed champion yet -- never hardcoded to 1', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], results: { champion: null } })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.championCount, 0)
})

test('Event-at-a-Glance: championCount is 1 for a completed event with one confirmed champion', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    results: { champion: { champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }], hasTie: false, standings: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 }] } },
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.championCount, 1)
})

test('Event-at-a-Glance: championCount is 2 for a genuine tied-champion outcome -- never silently collapsed to 1', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    results: {
      champion: {
        champions: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72 }, { playerId: 'p2', playerName: 'Dave', totalPoints: 72 }],
        hasTie: true,
        standings: [{ playerId: 'p1', playerName: 'Alex', totalPoints: 72, position: 1 }, { playerId: 'p2', playerName: 'Dave', totalPoints: 72, position: 1 }],
      },
    },
  })
  const deck = buildPresentationDeck(data, fullEventConfig())
  assert.equal(glanceSlide(deck.slides)!.championCount, 2)
})

test('Event-at-a-Glance: a round-scoped presentation never shows whole-event statistics, even if eventAtAGlance were somehow set true -- defensive scope guard, not just a UI convention', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, holes: 18 }), round({ id: 'r2', ordinal: 2, holes: 18 })],
  })
  const roundConfig: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, eventAtAGlance: true, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, roundConfig)
  assert.equal(glanceSlide(deck.slides), undefined)
})

test('getAvailableSections: EVENT_AT_A_GLANCE is unavailable with a reason when there are no rounds yet', () => {
  const data = baseData({ rounds: [] })
  const avail = getAvailableSections(data, { kind: 'fullEvent' })
  const entry = avail.find(a => a.type === 'EVENT_AT_A_GLANCE')!
  assert.equal(entry.available, false)
  assert.ok(entry.reason)
})

// -- V1.9 (6 Oct): selection architecture audit -----------------------

test('V1.9 bug fix: a Side Game winner with a genuine winnerPlayerId but a null winnerName (a failed display-name lookup) still counts as a real winner, everywhere this is checked', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'Longest Drive', holeNumber: 5, winnerPlayerId: 'p1', winnerName: null }],
  })
  // Availability.
  const avail = getAvailableSections(data, { kind: 'round', roundId: 'r1' })
  assert.equal(avail.find(a => a.type === 'SIDE_GAME_WINNERS')!.available, true)
  // Actual slide generation, both builders.
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: false, sideGameWinners: true, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  assert.equal(buildPresentationDeck(data, config).slides.filter(s => s.kind === 'sideGameWinner').length, 1)
  assert.equal(buildSlideshowDeck(data, 'all').slides.filter(s => s.kind === 'sideGameWinner').length, 1)
})

// -- resolveSelectedMomentIds: the single canonical resolver ----------

test('resolveSelectedMomentIds: favourites mode returns exactly every eligible Favourite across ALL included rounds, not just one', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [
      memory({ momentId: 'r1-fav', roundId: 'r1', organiserFavourite: true }),
      memory({ momentId: 'r1-not-fav', roundId: 'r1', organiserFavourite: false }),
      memory({ momentId: 'r2-fav', roundId: 'r2', organiserFavourite: true }),
    ],
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }, { roundId: 'r2', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const resolved = resolveSelectedMomentIds(data, config)
  assert.deepEqual([...resolved].sort(), ['r1-fav', 'r2-fav'])
})

test('resolveSelectedMomentIds: all mode is never shrunk by a stale selectedMomentIds list', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1' }), memory({ momentId: 'b', roundId: 'r1' })] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
    selectedMomentIds: ['a'], // stale, from a prior 'selected' session -- must be ignored entirely in 'all' mode
  }
  const resolved = resolveSelectedMomentIds(data, config)
  assert.deepEqual([...resolved].sort(), ['a', 'b'])
})

test('resolveSelectedMomentIds: selected mode excludes an id for a round that is no longer included', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 }), round({ id: 'r2', ordinal: 2 })],
    memories: [memory({ momentId: 'r1-photo', roundId: 'r1' }), memory({ momentId: 'r2-photo', roundId: 'r2' })],
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    // Only r1 is included for Best Moments now, even though r2-photo is still in selectedMomentIds.
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }, { roundId: 'r2', bestMoments: false, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'selected',
    selectedMomentIds: ['r1-photo', 'r2-photo'],
  }
  const resolved = resolveSelectedMomentIds(data, config)
  assert.deepEqual([...resolved], ['r1-photo'])
})

test('resolveSelectedMomentIds: zero Favourites in scope resolves to a genuinely empty set, not an error, and matches what buildPresentationDeck actually produces', () => {
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1 })], memories: [memory({ momentId: 'a', roundId: 'r1', organiserFavourite: false })] })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  assert.equal(resolveSelectedMomentIds(data, config).size, 0)
  assert.equal(photoMomentIdsInOrder(buildPresentationDeck(data, config)).length, 0)
})

test('resolveSelectedMomentIds: the count it implies matches buildPresentationDeck\'s own generated photo slides exactly -- the invariant this whole fix exists to guarantee', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'a', roundId: 'r1', organiserFavourite: true }), memory({ momentId: 'b', roundId: 'r1', organiserFavourite: true }), memory({ momentId: 'c', roundId: 'r1', organiserFavourite: false })],
  })
  const config: PresentationConfig = {
    scope: { kind: 'round', roundId: 'r1' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [{ roundId: 'r1', bestMoments: true, sideGameWinners: false, makersBreakers: false, roundResults: false }],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'favourites',
  }
  const resolvedCount = resolveSelectedMomentIds(data, config).size
  const actualSlideCount = photoMomentIdsInOrder(buildPresentationDeck(data, config)).length
  assert.equal(resolvedCount, 2)
  assert.equal(resolvedCount, actualSlideCount)
})

// -- V1.11 (7 Oct): middle-round Side Game Winners regression -------
// Required regression test, modelling the exact real-device scenario:
// three chronological rounds, each with a genuine, finalized Side
// Game winner (winnerPlayerId set) -- Round 2 specifically, since
// that is the round that failed on the real device. No round is
// special: availability and actual slide generation must both treat
// all three identically.

test('V1.11 regression: Side Game Winners availability is true for every round with a genuine winner, including the middle round -- no round is special', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r1', ordinal: 1, name: 'Round 1' }),
      round({ id: 'r2', ordinal: 2, name: 'Round 2' }),
      round({ id: 'r3', ordinal: 3, name: 'Round 3' }),
    ],
    sideGameWinners: [
      { sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'R1 Game', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex' },
      { sideCompId: 'sc2', roundId: 'r2', compType: 'nearest_pin', label: "Pro's Approach", holeNumber: 1, winnerPlayerId: 'p1', winnerName: 'Alex Schaefer' },
      { sideCompId: 'sc3', roundId: 'r2', compType: 'nearest_pin', label: 'Nearest the Pin', holeNumber: 6, winnerPlayerId: 'p2', winnerName: 'TEST' },
      { sideCompId: 'sc4', roundId: 'r3', compType: 'longest_drive', label: 'R3 Game', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex' },
    ],
  })
  for (const roundId of ['r1', 'r2', 'r3']) {
    const avail = getAvailableSections(data, { kind: 'round', roundId })
    assert.equal(avail.find(a => a.type === 'SIDE_GAME_WINNERS')!.available, true, `${roundId} should report Side Game Winners available`)
  }
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  for (const roundId of ['r1', 'r2', 'r3']) {
    assert.equal(config.rounds.find(r => r.roundId === roundId)!.sideGameWinners, true, `${roundId} should default Side Game Winners ON`)
  }
})

test('V1.11 regression: the deck itself actually generates winner slides for all three rounds, including both of Round 2\'s two winners (Alex Schaefer and TEST)', () => {
  const data = baseData({
    rounds: [
      round({ id: 'r1', ordinal: 1, name: 'Round 1' }),
      round({ id: 'r2', ordinal: 2, name: 'Round 2' }),
      round({ id: 'r3', ordinal: 3, name: 'Round 3' }),
    ],
    sideGameWinners: [
      { sideCompId: 'sc1', roundId: 'r1', compType: 'longest_drive', label: 'R1 Game', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex' },
      { sideCompId: 'sc2', roundId: 'r2', compType: 'nearest_pin', label: "Pro's Approach", holeNumber: 1, winnerPlayerId: 'p1', winnerName: 'Alex Schaefer' },
      { sideCompId: 'sc3', roundId: 'r2', compType: 'nearest_pin', label: 'Nearest the Pin', holeNumber: 6, winnerPlayerId: 'p2', winnerName: 'TEST' },
      { sideCompId: 'sc4', roundId: 'r3', compType: 'longest_drive', label: 'R3 Game', holeNumber: 5, winnerPlayerId: 'p1', winnerName: 'Alex' },
    ],
  })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
    rounds: [
      { roundId: 'r1', bestMoments: false, sideGameWinners: true, makersBreakers: false, roundResults: false },
      { roundId: 'r2', bestMoments: false, sideGameWinners: true, makersBreakers: false, roundResults: false },
      { roundId: 'r3', bestMoments: false, sideGameWinners: true, makersBreakers: false, roundResults: false },
    ],
    eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false, bestMomentsSource: 'all',
  }
  const deck = buildPresentationDeck(data, config)
  const winnerSlides = deck.slides.filter((s): s is Extract<Slide, { kind: 'sideGameWinner' }> => s.kind === 'sideGameWinner')
  assert.equal(winnerSlides.length, 4)
  const r2Names = winnerSlides.filter(s => s.winnerName === 'Alex Schaefer' || s.winnerName === 'TEST').map(s => s.winnerName).sort()
  assert.deepEqual(r2Names, ['Alex Schaefer', 'TEST'])
})

// -- V1.14 (8 Oct): Makers & Breakers group identity ------------------

test('Makers & Breakers: a group highlight exposes its full roster of player names, not just the group name', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [
      { kind: 'maker', icon: '\u{1F3F0}', title: 'The Fortress', playerName: '', statLine: '26.0 pt player average', roster: [{ playerId: 'p1', playerName: 'Alex Schaefer' }, { playerId: 'p2', playerName: 'Dave' }, { playerId: 'p3', playerName: 'Mick' }, { playerId: 'p4', playerName: 'Sam' }] },
    ] })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const card = makersBreakersSlides(deck.slides)[0]
  assert.deepEqual(card.highlight.roster?.map(m => m.playerName), ['Alex Schaefer', 'Dave', 'Mick', 'Sam'])
})

test('Makers & Breakers: an individual highlight (no roster) still exposes its own playerName, unchanged', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [
      { kind: 'breaker', icon: '\u2744\ufe0f', title: 'Ice Cold', playerName: 'Nobody Wins Here', statLine: 'y' },
    ] })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const card = makersBreakersSlides(deck.slides)[0]
  assert.equal(card.highlight.playerName, 'Nobody Wins Here')
  assert.equal(card.highlight.roster, undefined)
})

// =============================================================================
// V1.18 (10 Oct) -- SLIDESHOW FINAL RELEASE
// Closing Screen, Upload Moments & Moments and Bloopers Aftershow
// =============================================================================
// Package 8's own numbered test list, as far as pure deck/resolver logic
// can verify it in this sandbox (no browser, no database, no real file
// upload -- see the delivery report for exactly which of the 27 items
// these tests cover vs. require live-device verification).

function blooperMomentIds(slides: Slide[]): string[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'blooper' }> => s.kind === 'blooper').map(s => s.momentId)
}

// -- Closing screen (1-4) ----------------------------------------------

test('V1.18 #2/#4: exactly one closing slide is ever produced, and it always precedes the aftershow chapter when one exists', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'blooper-1', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
      memory({ momentId: 'blooper-2', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const closingCount = deck.slides.filter(s => s.kind === 'closing').length
  assert.equal(closingCount, 1)
  const closingIdx = deck.slides.findIndex(s => s.kind === 'closing')
  assert.equal(deck.aftershowStartIndex! > closingIdx, true)
})

test('V1.18 #4: with zero eligible aftershow media, the slideshow ends on the closing slide with no divider and no aftershowStartIndex at all', () => {
  const data = baseData({ memories: [memory({ momentId: 'ordinary', organiserFavourite: true })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.slides.at(-1)!.kind, 'closing')
  assert.ok(!deck.slides.some(s => s.kind === 'bloopersDivider'))
  assert.equal(deck.aftershowStartIndex, undefined)
})

// -- Upload Moments / unassigned event-level Moments (5-10, logic-testable parts) --

test('V1.18 #8: an unassigned event-level upload (playerId null, no round/hole) never fabricates context -- confirmed structurally on the EventMemoryData shape the deck builder consumes', () => {
  const data = baseData({
    memories: [memory({ momentId: 'unassigned-1', playerId: null, roundId: null, holeNumber: null, playerName: null })],
  })
  // An unassigned Moment is still a perfectly ordinary photo Moment for
  // the main presentation -- it just has no player/round attribution,
  // never a fabricated one. 'all' source includes it like any other.
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['unassigned-1'])
  const slide = deck.slides.find(s => s.kind === 'photo')!
  assert.equal((slide as Extract<Slide, { kind: 'photo' }>).playerName, null)
})

test('V1.18 #9/#10: an unassigned upload is eligible for the slideshow builder (appears in the main deck) exactly like any other Moment -- never silently hidden for lacking a player', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [memory({ momentId: 'unassigned-1', playerId: null, roundId: null })],
  })
  const avail = getAvailableSections(data, { kind: 'fullEvent' })
  assert.equal(avail.find(a => a.type === 'BEST_MOMENTS')?.available, true)
})

// -- Classification independence, including the new Aftershow flag (11-14) --

test('V1.18 #11/#12: a Moment can be Favourite=true, Blooper=false, Aftershow=true all at once -- three fully independent flags, none implying another', () => {
  const data = baseData({
    memories: [memory({ momentId: 'm1', organiserFavourite: true, isBlooper: false, aftershowIncluded: true })],
  })
  const ids = resolveAftershowMomentIds(data)
  assert.ok(ids.has('m1'))
  // Still shows up as an ordinary Favourite for the main presentation too.
  const deck = buildSlideshowDeck(data, 'favourites')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['m1'])
})

test('V1.18 #13: a Moment can be in the aftershow with neither Favourite nor Blooper set', () => {
  const data = baseData({
    memories: [memory({ momentId: 'm1', organiserFavourite: false, isBlooper: false, aftershowIncluded: true })],
  })
  assert.ok(resolveAftershowMomentIds(data).has('m1'))
})

test('V1.18 #14: removing a Moment from the aftershow never changes its Favourite/Blooper status -- the three flags are written independently', () => {
  const data = baseData({
    memories: [memory({ momentId: 'm1', organiserFavourite: true, isBlooper: true, aftershowIncluded: false })],
  })
  // Explicitly excluded from the aftershow...
  assert.ok(!resolveAftershowMomentIds(data).has('m1'))
  // ...yet still a Favourite in the main presentation, and still
  // flagged isBlooper on the record itself (resolveAftershowMomentIds
  // never mutates isBlooper/organiserFavourite -- it only reads them).
  const deck = buildSlideshowDeck(data, 'favourites')
  assert.deepEqual(photoMomentIdsInOrder(deck), ['m1'])
  assert.equal(data.memories[0].isBlooper, true)
})

// -- Selection: suggestion + persistence (15-19) --

test('V1.18 #15: Blooper-tagged Moments are suggested (included) by default, with no explicit organiser decision made yet', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true, aftershowIncluded: null })] })
  assert.ok(resolveAftershowMomentIds(data).has('b1'))
})

test('V1.18 #15: an unassigned event-level upload is suggested (included) by default too, alongside Blooper-tagged Moments -- both sets pre-selected, per the brief’s own worked rule', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'blooper', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
      memory({ momentId: 'unassigned', playerId: null }),
      memory({ momentId: 'ordinary-with-player' }),
    ],
  })
  const ids = resolveAftershowMomentIds(data)
  assert.ok(ids.has('blooper'))
  assert.ok(ids.has('unassigned'))
  assert.ok(!ids.has('ordinary-with-player'))
})

test('V1.18 #16: the organiser can remove a suggested Moment -- an explicit false always overrides the suggestion rule, even for a Blooper-tagged clip', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true, aftershowIncluded: false })] })
  assert.ok(!resolveAftershowMomentIds(data).has('b1'))
})

test('V1.18 #17: the organiser can add a Moment the suggestion rule would not have picked -- an explicit true always overrides, even for an ordinary photo with a known player', () => {
  const data = baseData({ memories: [memory({ momentId: 'p1photo', isBlooper: false, aftershowIncluded: true })] })
  assert.ok(resolveAftershowMomentIds(data).has('p1photo'))
})

test('V1.18 #18: a manual exclusion survives re-resolving from scratch (the slideshow builder “refreshing”) -- the decision lives on the Moment record, not in any session-only state the resolver itself could reset', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true, aftershowIncluded: false })] })
  // Calling the resolver twice, as two separate builder sessions would,
  // produces the identical result both times -- nothing about calling
  // it again silently reselects 'b1'.
  assert.deepEqual([...resolveAftershowMomentIds(data)], [...resolveAftershowMomentIds(data)])
  assert.ok(!resolveAftershowMomentIds(data).has('b1'))
})

test('V1.18 #19: a brand new upload is suggested normally without disturbing any other Moment’s own existing explicit decision -- the critical persistence requirement the brief flags most heavily', () => {
  const before = baseData({
    memories: [
      memory({ momentId: 'blooper-excluded', mediaType: 'video', durationSeconds: 5, isBlooper: true, aftershowIncluded: false }),
      memory({ momentId: 'manually-included', isBlooper: false, aftershowIncluded: true }),
    ],
  })
  const idsBefore = resolveAftershowMomentIds(before)
  assert.ok(!idsBefore.has('blooper-excluded'))
  assert.ok(idsBefore.has('manually-included'))

  // A new upload arrives -- aftershowIncluded still null, the default
  // for anything that's never been decided. The two existing Moments'
  // own rows are untouched (exactly as a real new INSERT would leave
  // every other row untouched).
  const after = baseData({
    memories: [
      ...before.memories,
      memory({ momentId: 'new-unassigned-upload', playerId: null, aftershowIncluded: null }),
    ],
  })
  const idsAfter = resolveAftershowMomentIds(after)
  assert.ok(!idsAfter.has('blooper-excluded'), 'the prior manual exclusion must still be respected after a new upload')
  assert.ok(idsAfter.has('manually-included'), 'the prior manual inclusion must still be respected after a new upload')
  assert.ok(idsAfter.has('new-unassigned-upload'), 'the new upload is suggested normally, following the default rule')
})

// -- Playback / looping (20-27, deck-level contract the player consumes) --

test('V1.18 #20/#21: the aftershow has its own start index, strictly after every formal-presentation slide including the closing screen -- "only Moments & Bloopers should repeat"', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1 })],
    memories: [
      memory({ momentId: 'ordinary', roundId: 'r1', organiserFavourite: true }),
      memory({ momentId: 'blooper', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'favourites')
  assert.ok(deck.aftershowStartIndex !== undefined)
  // Everything before aftershowStartIndex is the formal presentation --
  // the closing slide in particular must be one of those, never inside
  // or after the aftershow's own slides.
  const formalSlides = deck.slides.slice(0, deck.aftershowStartIndex)
  assert.ok(formalSlides.some(s => s.kind === 'closing'))
  const aftershowSlides = deck.slides.slice(deck.aftershowStartIndex)
  assert.ok(!aftershowSlides.some(s => s.kind === 'closing'), 'the closing screen must never be inside the looping aftershow range')
})

test('V1.18 #23: the closing screen appears exactly once even when the aftershow has multiple clips -- it is never duplicated to "frame" each loop', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
      memory({ momentId: 'b2', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
      memory({ momentId: 'b3', mediaType: 'video', durationSeconds: 5, isBlooper: true }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.slides.filter(s => s.kind === 'closing').length, 1)
  assert.deepEqual(blooperMomentIds(deck.slides), ['b1', 'b2', 'b3'])
})

test('V1.18 #26: aftershowLoop defaults to true (Package 5.2’s own default settings table: "Repeat aftershow = ON") whenever aftershow content exists', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(deck.aftershowLoop, true)
})

test('V1.18 #26: the organiser can turn looping off via PresentationConfig.aftershowLoop -- buildPresentationDeck carries that choice through onto the returned deck', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: false, bloopers: true, aftershowLoop: false, eventFinale: true,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  assert.equal(deck.aftershowLoop, false)
  // The chapter itself still plays (just doesn't loop) -- confirmed
  // the content is still there, not accidentally suppressed too.
  assert.ok(deck.aftershowStartIndex !== undefined)
})

test('V1.18 #27: the new builder (buildPresentationDeck) also orders the closing screen before the aftershow chapter, matching buildSlideshowDeck exactly', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const config: PresentationConfig = {
    scope: { kind: 'fullEvent' }, eventOpening: false, eventAtAGlance: false, groupPhoto: false, rounds: [],
    eventChampion: false, finalLeaderboard: false, bloopers: true, eventFinale: true,
    bestMomentsSource: 'favourites',
  }
  const deck = buildPresentationDeck(data, config)
  const kinds = deck.slides.map(s => s.kind)
  assert.ok(kinds.indexOf('closing') < kinds.indexOf('bloopersDivider'))
})

test('V1.18: getAvailableSections labels the chapter "Moments & Bloopers", not "Bloopers" -- Package 4’s explicit rename', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const avail = getAvailableSections(data, { kind: 'fullEvent' })
  assert.equal(avail.find(a => a.type === 'BLOOPERS')?.label, 'Moments & Bloopers')
})

test('V1.18: defaultPresentationConfig sets aftershowLoop true for a full-event presentation, matching Package 5.2’s stated default', () => {
  const data = baseData({ memories: [memory({ momentId: 'b1', mediaType: 'video', durationSeconds: 5, isBlooper: true })] })
  const config = defaultPresentationConfig(data, { kind: 'fullEvent' })
  assert.equal(config.aftershowLoop, true)
})
