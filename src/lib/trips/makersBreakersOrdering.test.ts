import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSlideshowDeck, type Slide } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

// Regression coverage for the approved "Final Slideshow Polish &
// Closing Slide Release" brief, item 3: within a round, published
// Makers & Breakers must present in this order -- Individual Makers,
// then Individual Breakers, then Group Makers, then Group Breakers,
// each chronological (early to late holes), e.g. Hot Start before
// Fast Finish or Iceman. Uses the real published-highlight shape
// (kind/scope/category/playerName/statLine/roster), exactly what
// published_round_highlights.highlights actually stores -- not a
// simplified test-only fixture.

function round(overrides: Partial<EventMemoryData['rounds'][number]> & { id: string; ordinal: number }): EventMemoryData['rounds'][number] {
  return { name: `Round ${overrides.ordinal}`, courseName: null, playDate: '2026-09-11', status: 'completed', holes: 18, publishedHighlights: null, winners: null, standings: null, ...overrides }
}

function baseData(overrides: Partial<EventMemoryData> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Darren’s Golf Trip 2026', eventType: 'tournament', location: null, startDate: '2026-09-11', endDate: '2026-09-13', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [], memories: [], sideGameWinners: [], sideGameCount: 0, playerCount: 4, results: { champion: null },
    ...overrides,
  }
}

function makersBreakersSlides(slides: Slide[]): Extract<Slide, { kind: 'makersBreakersCard' }>[] {
  return slides.filter((s): s is Extract<Slide, { kind: 'makersBreakersCard' }> => s.kind === 'makersBreakersCard')
}

function titles(slides: Slide[]): string[] {
  return makersBreakersSlides(slides).map(s => s.highlight.title)
}

test('individual makers present before individual breakers, before group makers, before group breakers', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'breaker', scope: 'group', category: 'wheels_off', icon: '\u{1F6DE}', title: 'Wheels Off', playerName: '', statLine: 'x', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
        { kind: 'maker', scope: 'group', category: 'hot_group', icon: '\u{1F525}', title: 'The Hot Group', playerName: '', statLine: 'y', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
        { kind: 'breaker', scope: 'individual', category: 'wipeout_king', icon: '\u{1F4A5}', title: 'Wipeout King', playerName: 'Dave', statLine: 'z' },
        { kind: 'maker', scope: 'individual', category: 'hot_start', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex', statLine: 'w' },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(titles(deck.slides), ['Hot Start', 'Wipeout King', 'The Hot Group', 'Wheels Off'])
})

test('within individual makers, Hot Start (early) presents before Fast Finish (late) and before Iceman (mid, whole round) -- the brief\'s own worked example', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'maker', scope: 'individual', category: 'fast_finish', icon: '\u{1F680}', title: 'Fast Finish', playerName: 'Dave', statLine: 'a' },
        { kind: 'maker', scope: 'individual', category: 'mr_consistent', icon: '\u{1F9CA}', title: 'Iceman', playerName: 'Mick', statLine: 'b' },
        { kind: 'maker', scope: 'individual', category: 'hot_start', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex', statLine: 'c' },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(titles(deck.slides), ['Hot Start', 'Iceman', 'Fast Finish'])
})

test('within individual breakers, Cold Start (early) presents before Rough Finish (late)', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'breaker', scope: 'individual', category: 'rough_finish', icon: '\u{1F62C}', title: 'Rough Finish', playerName: 'Dave', statLine: 'a' },
        { kind: 'breaker', scope: 'individual', category: 'cold_start', icon: '\u{1F9CA}', title: 'Cold Start', playerName: 'Mick', statLine: 'b' },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(titles(deck.slides), ['Cold Start', 'Rough Finish'])
})

test('within group makers, The Hot Group (mid, whole round) presents before Back Nine Bandits (late)', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'maker', scope: 'group', category: 'back_nine_bandits', icon: '\u{1F451}', title: 'Back Nine Bandits', playerName: '', statLine: 'a', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
        { kind: 'maker', scope: 'group', category: 'hot_group', icon: '\u{1F525}', title: 'The Hot Group', playerName: '', statLine: 'b', roster: [{ playerId: 'p2', playerName: 'Dave' }] },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(titles(deck.slides), ['The Hot Group', 'Back Nine Bandits'])
})

test('within group breakers, Still in the Car Park (early) presents before Back Nine Breakdown (late)', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'breaker', scope: 'group', category: 'back_nine_breakdown', icon: '\u{1F3DA}️', title: 'Back Nine Breakdown', playerName: '', statLine: 'a', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
        { kind: 'breaker', scope: 'group', category: 'still_in_car_park', icon: '\u{1F697}', title: 'Still in the Car Park', playerName: '', statLine: 'b', roster: [{ playerId: 'p2', playerName: 'Dave' }] },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  assert.deepEqual(titles(deck.slides), ['Still in the Car Park', 'Back Nine Breakdown'])
})

test('two highlights in the same bucket and the same phase keep their original (significance-descending) relative order -- a stable sort, not a re-rank', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'maker', scope: 'individual', category: 'mr_consistent', icon: '\u{1F9CA}', title: 'Iceman', playerName: 'Mick', statLine: 'strongest' },
        { kind: 'maker', scope: 'individual', category: 'birdie_hunter', icon: '\u{1F426}', title: 'Birdie Hunter', playerName: 'Alex', statLine: 'second' },
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  // Both are "mid" phase (whole-round categories) -- original input order preserved.
  assert.deepEqual(titles(deck.slides), ['Iceman', 'Birdie Hunter'])
})

test('a highlight with no scope/category (legacy published row, predating this field) still renders, defaulting to individual + mid phase, never dropped', () => {
  const data = baseData({
    rounds: [round({
      id: 'r1', ordinal: 1,
      publishedHighlights: [
        { kind: 'maker', scope: 'group', category: 'hot_group', icon: '\u{1F525}', title: 'The Hot Group', playerName: '', statLine: 'a', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
        { kind: 'maker', icon: '\u{1F525}', title: 'Legacy Highlight', playerName: 'Dave', statLine: 'b' }, // no scope/category at all
      ],
    })],
  })
  const deck = buildSlideshowDeck(data, 'all')
  const result = titles(deck.slides)
  assert.equal(result.length, 2)
  // Legacy highlight defaults to scope='individual', so it still sorts before the group maker.
  assert.deepEqual(result, ['Legacy Highlight', 'The Hot Group'])
})

test('no badge-awarding rule is affected -- every published highlight still appears exactly once, only reordered', () => {
  const highlights = [
    { kind: 'breaker' as const, scope: 'group' as const, category: 'wheels_off', icon: '\u{1F6DE}', title: 'Wheels Off', playerName: '', statLine: 'x', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
    { kind: 'maker' as const, scope: 'group' as const, category: 'hot_group', icon: '\u{1F525}', title: 'The Hot Group', playerName: '', statLine: 'y', roster: [{ playerId: 'p1', playerName: 'Alex' }] },
    { kind: 'breaker' as const, scope: 'individual' as const, category: 'wipeout_king', icon: '\u{1F4A5}', title: 'Wipeout King', playerName: 'Dave', statLine: 'z' },
    { kind: 'maker' as const, scope: 'individual' as const, category: 'hot_start', icon: '\u{1F525}', title: 'Hot Start', playerName: 'Alex', statLine: 'w' },
  ]
  const data = baseData({ rounds: [round({ id: 'r1', ordinal: 1, publishedHighlights: highlights })] })
  const deck = buildSlideshowDeck(data, 'all')
  const resultTitles = titles(deck.slides).sort()
  const inputTitles = highlights.map(h => h.title).sort()
  assert.deepEqual(resultTitles, inputTitles)
})
