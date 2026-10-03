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
    mediaType: 'photo', durationSeconds: null, isBlooper: false,
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
function makersBreakersSlides(slides: Slide[]): Extract<Slide, { kind: 'makersBreakers' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'makersBreakers' }> => s.kind === 'makersBreakers')
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

test('Leaderboard pagination: more than 10 standings produces multiple pages, never squeezed onto one slide', () => {
  const standings = Array.from({ length: 23 }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i}`, totalPoints: 100 - i, position: i + 1 }))
  const data = baseData({ results: { champion: { champions: [standings[0]], hasTie: false, standings } } })
  const deck = buildSlideshowDeck(data, 'all')
  const pages = leaderboardSlides(deck.slides)
  assert.equal(pages.length, 3) // 23 entries / 10 per page = 3 pages
  assert.equal(pages[0].entries.length, 10)
  assert.equal(pages[1].entries.length, 10)
  assert.equal(pages[2].entries.length, 3)
  assert.deepEqual(pages.map(p => p.page), [1, 2, 3])
  assert.ok(pages.every(p => p.totalPages === 3))
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

test('Makers & Breakers present: a published highlight for a round produces a makersBreakers slide with that content verbatim', () => {
  const data = baseData({
    rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: [{ kind: 'maker', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex Schaefer', statLine: 'Birdied the first 3 holes' }] })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const mb = makersBreakersSlides(deck.slides)
  assert.equal(mb.length, 1)
  assert.equal(mb[0].highlights[0].title, 'Hot Start')
  assert.equal(mb[0].highlights[0].playerName, 'Alex Schaefer')
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

test('Bloopers: only organiser-selected (isBlooper) video Memories appear, in a dedicated chapter after a divider', () => {
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
  assert.equal(bloopers[0].videoUrl, 'https://x/clip.mp4')
  assert.equal(bloopers[0].durationSeconds, 9)
  assert.ok(deck.slides.some(s => s.kind === 'bloopersDivider'))
})

test('Bloopers: a photo or text Moment flagged isBlooper is still excluded -- Bloopers means video specifically', () => {
  const data = baseData({
    memories: [
      memory({ momentId: 'photo-flagged', mediaType: 'photo', isBlooper: true }),
      memory({ momentId: 'text-flagged', mediaType: 'text', imageUrl: null, caption: 'oops', isBlooper: true }),
    ],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.equal(blooperSlides(deck.slides).length, 0)
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
