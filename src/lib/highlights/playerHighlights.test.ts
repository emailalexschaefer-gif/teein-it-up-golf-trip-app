import test from 'node:test'
import assert from 'node:assert/strict'
import { filterPublishedHighlightsForPlayer } from './playerHighlights'
import type { Highlight } from './makersBreakers'

function h(overrides: Partial<Highlight>): Highlight {
  return {
    category: 'test', kind: 'maker', scope: 'individual', icon: '🐦', title: 'Test',
    playerId: '', playerName: '', statLine: '', significance: 1,
    ...overrides,
  }
}

test('filterPublishedHighlightsForPlayer — personal highlight is returned for the matching player only', () => {
  const highlights = [h({ category: 'birdie_hunter', title: 'The Birdman', scope: 'individual', playerId: 'alex', playerName: 'Alex' })]
  const alexResult = filterPublishedHighlightsForPlayer(highlights, 'alex', null)
  assert.equal(alexResult.personal.length, 1)
  assert.equal(alexResult.personal[0].title, 'The Birdman')

  const daveResult = filterPublishedHighlightsForPlayer(highlights, 'dave', null)
  assert.equal(daveResult.personal.length, 0)
})

test('filterPublishedHighlightsForPlayer — group highlight is returned only for players in that round-specific group', () => {
  const highlights = [h({ category: 'back_nine_bandits', title: 'Back Nine Bandits', scope: 'group', groupId: 'group-2', groupName: 'Group 2' })]

  const alexResult = filterPublishedHighlightsForPlayer(highlights, 'alex', 'group-2')
  assert.equal(alexResult.group.length, 1)
  assert.equal(alexResult.group[0].title, 'Back Nine Bandits')

  const mickResult = filterPublishedHighlightsForPlayer(highlights, 'mick', 'group-1')
  assert.equal(mickResult.group.length, 0)
})

test('filterPublishedHighlightsForPlayer — a player with no group assignment for the round receives no group highlights', () => {
  const highlights = [h({ category: 'hot_group', scope: 'group', groupId: 'group-2' })]
  const result = filterPublishedHighlightsForPlayer(highlights, 'alex', null)
  assert.equal(result.group.length, 0)
})

test('filterPublishedHighlightsForPlayer — unselected candidates never appear, because only the published subset is ever passed in', () => {
  const publishedOnly = [
    h({ category: 'birdie_hunter', title: 'The Birdman', scope: 'individual', playerId: 'alex' }),
    h({ category: 'maverick', title: 'Maverick', scope: 'individual', playerId: 'alex' }),
  ]
  const result = filterPublishedHighlightsForPlayer(publishedOnly, 'alex', null)
  assert.equal(result.personal.length, 2)
  assert.ok(!result.personal.some(hl => hl.category === 'the_heater'))
  assert.ok(!result.personal.some(hl => hl.category === 'mr_consistent'))
})

test('filterPublishedHighlightsForPlayer — a group highlight for a different scope entirely is never mixed into personal', () => {
  const highlights = [
    h({ category: 'birdie_hunter', scope: 'individual', playerId: 'alex' }),
    h({ category: 'hot_group', scope: 'group', groupId: 'group-1' }),
  ]
  const result = filterPublishedHighlightsForPlayer(highlights, 'alex', 'group-1')
  assert.equal(result.personal.length, 1)
  assert.equal(result.group.length, 1)
  assert.notEqual(result.personal[0].category, result.group[0].category)
})
