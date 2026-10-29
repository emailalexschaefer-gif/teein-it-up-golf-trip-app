import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestTeams, canConfirmTeams } from './suggestTeams'

const G = (id: string, players: string[]) => ({ groupId: id, groupName: `Group ${id}`, playerIdsInSlotOrder: players })

test('two-person Ambrose: slots 1+2 = Team A, 3+4 = Team B, with text labels and two shades', () => {
  const [s] = suggestTeams('ambrose_2', [G('1', ['a', 'b', 'c', 'd'])])
  assert.deepEqual(s.teams.map(t => [t.label, t.shadeIndex, t.slots, t.playerIds]), [['Team A', 0, [1, 2], ['a', 'b']], ['Team B', 1, [3, 4], ['c', 'd']]])
  assert.deepEqual(s.teams.map(t => t.name), ['Group 1 · Team A', 'Group 1 · Team B']); assert.deepEqual(canConfirmTeams([s]), { ok: true })
})
test('four-person Ambrose: all four slots are one team', () => {
  const [s] = suggestTeams('ambrose_4', [G('1', ['a', 'b', 'c', 'd'])])
  assert.equal(s.teams.length, 1); assert.deepEqual(s.teams[0].playerIds, ['a', 'b', 'c', 'd']); assert.equal(s.teams[0].name, 'Group 1 team')
})
test('slot order drives the suggestion; reordering the group re-suggests but never touches saved teams', () => {
  const [s] = suggestTeams('ambrose_2', [G('1', ['d', 'a', 'c', 'b'])])
  assert.deepEqual(s.teams.map(t => t.playerIds), [['d', 'a'], ['c', 'b']])
  // a and b are already on SAVED teams (e.g. scoring has started): they are left out of the suggestion and reported, not re-assigned
  const [kept] = suggestTeams('ambrose_2', [G('1', ['a', 'b', 'c', 'd'])], new Set(['a', 'b']))
  assert.deepEqual(kept.alreadyAssigned, ['a', 'b']); assert.deepEqual(kept.teams.map(t => t.playerIds), [['c', 'd']])
})
test('short or odd groups leave Unassigned players and block confirmation; nothing is padded or guessed', () => {
  const r = suggestTeams('ambrose_2', [G('1', ['a', 'b', 'c']), G('2', ['d'])])
  assert.deepEqual(r[0].unassigned, ['c']); assert.deepEqual(r[1].unassigned, ['d']); assert.equal(r[1].teams.length, 0)
  const c = canConfirmTeams(r); assert.equal(c.ok, false)
  const three = suggestTeams('ambrose_4', [G('1', ['a', 'b', 'c'])])
  assert.equal(three[0].teams.length, 0); assert.deepEqual(three[0].unassigned, ['a', 'b', 'c'])
})
test('five players in a four-ball group: one whole team plus one unassigned', () => {
  const [s] = suggestTeams('ambrose_4', [G('1', ['a', 'b', 'c', 'd', 'e'])])
  assert.equal(s.teams.length, 1); assert.deepEqual(s.unassigned, ['e'])
})
test('a player listed in two groups is reported, not duplicated', () => {
  const r = suggestTeams('ambrose_2', [G('1', ['a', 'b']), G('2', ['a', 'c'])])
  assert.ok(r[1].issues.some(i => /more than one group/.test(i))); assert.equal(canConfirmTeams(r).ok, false)
})
test('team names are unique across groups', () => {
  const names = suggestTeams('ambrose_2', [G('1', ['a', 'b', 'c', 'd']), G('2', ['e', 'f', 'g', 'h'])]).flatMap(s => s.teams.map(t => t.name))
  assert.equal(new Set(names).size, names.length)
})
