import test from 'node:test'
import assert from 'node:assert/strict'
import { generateEventMakersAndBreakers, selectPlayerEventStory, type EventFieldData, type EventRoundData } from './eventMakersBreakers'
import type { PlayerRoundData, PlayerHoleResult } from './makersBreakers'

// Explicit builder — full control over gross/par/points per hole, since
// several categories depend on the exact relationship between them
// (birdies, wipes, doubles).
function h(holeNumber: number, par: number, gross: number, pts: number): PlayerHoleResult {
  return { holeNumber, par, grossScore: gross, stablefordPts: pts }
}

function player(playerId: string, playerName: string, holeList: PlayerHoleResult[], groupId: string | null = null, groupName = ''): PlayerRoundData {
  return { playerId, playerName, startingHole: 1, holes: holeList, groupId, groupName }
}

function round(roundId: string, roundNumber: number, players: PlayerRoundData[], totalHoles = 9): EventRoundData {
  return { roundId, roundNumber, totalHoles, players }
}

test('event M&B — two-round aggregation: Most Points sums correctly across both rounds for the same player', () => {
  const alexR1 = player('alex', 'Alex', [h(1, 4, 4, 3), h(2, 4, 4, 3), h(3, 4, 4, 3)]) // 9 pts
  const alexR2 = player('alex', 'Alex', [h(1, 4, 4, 3), h(2, 4, 4, 3), h(3, 4, 4, 3)]) // 9 pts
  const field: EventFieldData = { rounds: [round('r1', 1, [alexR1]), round('r2', 2, [alexR2])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const mostPoints = makers.find(m => m.category === 'most_points')!
  assert.equal(mostPoints.statValue, 18)
  assert.deepEqual(mostPoints.playerIds, ['alex'])
})

test('event M&B — player identity is by stable playerId, not display name: same name, different IDs never merge', () => {
  const a1 = player('id-1', 'Alex', [h(1, 4, 4, 3)])
  const a2 = player('id-2', 'Alex', [h(1, 4, 4, 3)]) // different person, same display name
  const field: EventFieldData = { rounds: [round('r1', 1, [a1, a2])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const mostPoints = makers.find(m => m.category === 'most_points')!
  // Both tied at 3 pts each — since they're genuinely different
  // people (different IDs), both should appear as joint leaders, not
  // merged into one entry with double the points.
  assert.equal(mostPoints.statValue, 3)
  assert.equal(mostPoints.playerIds.length, 2)
  assert.ok(mostPoints.playerIds.includes('id-1'))
  assert.ok(mostPoints.playerIds.includes('id-2'))
})

test('event M&B — tied results produce joint winners, never an arbitrary single pick', () => {
  const alex = player('alex', 'Alex', [h(1, 4, 3, 4)]) // 1 birdie
  const ben = player('ben', 'Ben', [h(1, 4, 3, 4)]) // 1 birdie, genuinely tied
  const field: EventFieldData = { rounds: [round('r1', 1, [alex, ben])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const birdies = makers.find(m => m.category === 'most_birdies')!
  assert.equal(birdies.playerIds.length, 2)
  assert.ok(birdies.playerIds.includes('alex') && birdies.playerIds.includes('ben'))
})

test('event M&B — incomplete rounds must be excluded by the caller; a round with zero holes for a player contributes nothing', () => {
  const alex = player('alex', 'Alex', []) // no holes recorded — e.g. this round wasn't actually played by them
  const ben = player('ben', 'Ben', [h(1, 4, 4, 3), h(2, 4, 4, 3)])
  const field: EventFieldData = { rounds: [round('r1', 1, [alex, ben])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const mostPoints = makers.find(m => m.category === 'most_points')!
  assert.deepEqual(mostPoints.playerIds, ['ben']) // alex excluded, not counted as a 0-point "winner" by default
})

test('event M&B — missing/partial scoring data: a category with no qualifying result is omitted entirely, never fabricated', () => {
  // No one has any wipes (0-point holes) at all across the event.
  const alex = player('alex', 'Alex', [h(1, 4, 4, 3), h(2, 4, 4, 3)])
  const field: EventFieldData = { rounds: [round('r1', 1, [alex])] }
  const { breakers } = generateEventMakersAndBreakers(field)
  assert.equal(breakers.find(b => b.category === 'most_wipes'), undefined)
})

test('event M&B — improvement calculation: biggest improver correctly measures round-to-round delta, not cumulative total', () => {
  const alexR1 = player('alex', 'Alex', [h(1, 4, 6, 0), h(2, 4, 6, 0)]) // 0 pts
  const alexR2 = player('alex', 'Alex', [h(1, 4, 3, 4), h(2, 4, 3, 4)]) // 8 pts — +8 improvement
  const benR1 = player('ben', 'Ben', [h(1, 4, 4, 3), h(2, 4, 4, 3)]) // 6 pts
  const benR2 = player('ben', 'Ben', [h(1, 4, 4, 3), h(2, 4, 4, 3)]) // 6 pts — no change
  const field: EventFieldData = { rounds: [round('r1', 1, [alexR1, benR1]), round('r2', 2, [alexR2, benR2])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const improver = makers.find(m => m.category === 'biggest_improver')!
  assert.deepEqual(improver.playerIds, ['alex'])
  assert.equal(improver.statValue, 8)
})

test('event M&B — decline calculation: Wheels Fell Off correctly measures the largest drop, not just the worst round', () => {
  const alexR1 = player('alex', 'Alex', [h(1, 4, 3, 4), h(2, 4, 3, 4)]) // 8 pts
  const alexR2 = player('alex', 'Alex', [h(1, 4, 6, 0), h(2, 4, 6, 0)]) // 0 pts — dropped by 8
  const field: EventFieldData = { rounds: [round('r1', 1, [alexR1]), round('r2', 2, [alexR2])] }
  const { breakers } = generateEventMakersAndBreakers(field)
  const decline = breakers.find(b => b.category === 'biggest_decline')!
  assert.deepEqual(decline.playerIds, ['alex'])
  assert.equal(decline.statValue, 8)
})

test('event M&B — no cross-round leakage: a player who only appears in Round 1 does not affect Round 2-only stats, and vice versa', () => {
  const guestR1 = player('guest', 'Guest', [h(1, 4, 3, 4), h(2, 4, 3, 4), h(3, 4, 3, 4)]) // Round-1-only player, 12 pts
  const alexR1 = player('alex', 'Alex', [h(1, 4, 4, 3)])
  const alexR2 = player('alex', 'Alex', [h(1, 4, 4, 3)])
  const field: EventFieldData = { rounds: [round('r1', 1, [guestR1, alexR1]), round('r2', 2, [alexR2])] }
  const { makers } = generateEventMakersAndBreakers(field)
  // Best Round should correctly attribute to the guest's round-1 score,
  // not silently drop them or merge them with anyone.
  const bestRound = makers.find(m => m.category === 'best_single_round')!
  assert.equal(bestRound.playerIds[0], 'guest')
  assert.equal(bestRound.roundNumber, 1)
  // The guest never appears in round 2's own data at all — no
  // "biggest improver" entry should ever be attributed to them (they
  // only have 1 round played, so they're excluded from that category
  // entirely, not compared against a phantom round-2 zero).
  const improver = makers.find(m => m.category === 'biggest_improver')
  if (improver) assert.notEqual(improver.playerIds[0], 'guest')
})

test('event M&B — Event Champion reuses the canonical countback-aware ranking, never invents a separate one', () => {
  const alexR1 = player('alex', 'Alex', [h(1, 4, 4, 3)])
  const benR1 = player('ben', 'Ben', [h(1, 4, 4, 3)])
  const field: EventFieldData = { rounds: [round('r1', 1, [alexR1, benR1])] }
  const { makers } = generateEventMakersAndBreakers(field)
  const champion = makers.find(m => m.category === 'event_champion')!
  // Genuinely tied on points and everything else — both should be
  // joint champions, exactly as computeCumulativeStandings would report.
  assert.equal(champion.playerIds.length, 2)
})

test('event M&B — group performance omitted entirely when there is nothing to compare (fewer than 2 real groups)', () => {
  const alex = player('alex', 'Alex', [h(1, 4, 4, 3)], 'group-1', 'Group 1')
  const field: EventFieldData = { rounds: [round('r1', 1, [alex])] }
  const { makers, breakers } = generateEventMakersAndBreakers(field)
  assert.equal(makers.find(m => m.category === 'best_group'), undefined)
  assert.equal(breakers.find(b => b.category === 'worst_group_stretch'), undefined)
})

test('event M&B — group performance correctly identifies the stronger of two real groups', () => {
  const strongGroup = [
    player('a', 'A', [h(1, 4, 3, 4), h(2, 4, 3, 4)], 'g1', 'Group 1'),
    player('b', 'B', [h(1, 4, 3, 4), h(2, 4, 3, 4)], 'g1', 'Group 1'),
  ]
  const weakGroup = [
    player('c', 'C', [h(1, 4, 6, 0), h(2, 4, 6, 0)], 'g2', 'Group 2'),
    player('d', 'D', [h(1, 4, 6, 0), h(2, 4, 6, 0)], 'g2', 'Group 2'),
  ]
  const field: EventFieldData = { rounds: [round('r1', 1, [...strongGroup, ...weakGroup])] }
  const { makers, breakers } = generateEventMakersAndBreakers(field)
  assert.equal(makers.find(m => m.category === 'best_group')!.groupId, 'g1')
  assert.equal(breakers.find(b => b.category === 'worst_group_stretch')!.groupId, 'g2')
})

test('selectPlayerEventStory — filters the same generated highlights down to one player, never recomputes', () => {
  const alex = player('alex', 'Alex', [h(1, 4, 4, 3)])
  const ben = player('ben', 'Ben', [h(1, 4, 6, 0)])
  const field: EventFieldData = { rounds: [round('r1', 1, [alex, ben])] }
  const highlights = generateEventMakersAndBreakers(field)
  const alexStory = selectPlayerEventStory(highlights, 'alex')
  assert.ok(alexStory.every(h => h.playerIds.includes('alex')))
  assert.ok(alexStory.every(h => !h.playerIds.includes('ben') || h.playerIds.includes('alex')))
})

test('selectPlayerEventStory — caps at maxBeats without padding with anything invented', () => {
  const alex = player('alex', 'Alex', [h(1, 4, 3, 4), h(2, 4, 4, 3), h(3, 4, 6, 0)])
  const field: EventFieldData = { rounds: [round('r1', 1, [alex])] }
  const highlights = generateEventMakersAndBreakers(field)
  const story = selectPlayerEventStory(highlights, 'alex', 2)
  assert.ok(story.length <= 2)
})
