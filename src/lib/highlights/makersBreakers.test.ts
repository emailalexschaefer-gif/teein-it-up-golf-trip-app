import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getPlayedSequence, findHotStart, findBackNineKing,
  findBirdieHunter, findMrConsistent, findRoundPerformer,
  findWipeoutKing, findTheCollapse,
  findHoleFromHell, findOneThatGotAway, generateMakersAndBreakers,
  type FieldRoundData, type PlayerRoundData, type PlayerHoleResult,
} from './makersBreakers'

function makeHoles(pts: number[], par = 4, startGross = 4): PlayerHoleResult[] {
  return pts.map((p, i) => ({ holeNumber: i + 1, stablefordPts: p, grossScore: startGross, par }))
}

function player(id: string, name: string, holes: PlayerHoleResult[], startingHole = 1): PlayerRoundData {
  return { playerId: id, playerName: name, startingHole, holes }
}

test('getPlayedSequence — standard round is a no-op reorder', () => {
  const p = player('a', 'Alex', makeHoles([1, 2, 3, 4, 5, 6, 7, 8, 9]), 1)
  const seq = getPlayedSequence(p, 9)
  assert.deepEqual(seq.map(h => h.holeNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('getPlayedSequence — shotgun start wraps around correctly', () => {
  const p = player('a', 'Alex', makeHoles([1, 2, 3, 4, 5, 6, 7, 8, 9]), 7)
  const seq = getPlayedSequence(p, 9)
  // Started on hole 7 -> played order is 7,8,9,1,2,3,4,5,6
  assert.deepEqual(seq.map(h => h.holeNumber), [7, 8, 9, 1, 2, 3, 4, 5, 6])
})

test('findHotStart — respects shotgun played sequence, not hole numbers 1-3', () => {
  // Player A: holes 1-3 (by number) are low, but they started on hole 7,
  // so their ACTUAL opening 3 (holes 7,8,9) are high.
  const holesA = makeHoles([0, 0, 0, 9, 9, 9, 9, 9, 9])
  const a = player('a', 'Alex', holesA, 7)
  const b = player('b', 'Dave', makeHoles([1, 1, 1, 1, 1, 1, 1, 1, 1]), 1)
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findHotStart(field)
  assert.equal(result?.playerId, 'a')
  // holes 7,8,9 (by number) each have 9 pts in holesA's array (indices 6,7,8 -> values 9,9,9)
  assert.equal(result?.statLine, '27 points from the opening 3 holes')
})

test('findBackNineKing — returns null for a 9-hole round, does not invent data', () => {
  const field: FieldRoundData = {
    players: [player('a', 'Alex', makeHoles([2, 2, 2, 2, 2, 2, 2, 2, 2]))],
    totalHoles: 9,
  }
  assert.equal(findBackNineKing(field), null)
})

test('findBackNineKing — works correctly for 18-hole rounds', () => {
  const front = new Array(9).fill(1)
  const backA = new Array(9).fill(3)
  const backB = new Array(9).fill(1)
  const a = player('a', 'Alex', makeHoles([...front, ...backA]))
  const b = player('b', 'Dave', makeHoles([...front, ...backB]))
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findBackNineKing(field)
  assert.equal(result?.playerId, 'a')
  assert.equal(result?.statLine, '27 points coming home')
})

test('findTheCollapse — returns null for a 9-hole round', () => {
  const field: FieldRoundData = { players: [player('a', 'Alex', makeHoles(new Array(9).fill(2)))], totalHoles: 9 }
  assert.equal(findTheCollapse(field), null)
})

test('findTheCollapse — trivial 1-point difference does not trigger', () => {
  const front = [2, 2, 2, 2, 2, 2, 2, 2, 3] // 17
  const back = [2, 2, 2, 2, 2, 2, 2, 2, 2]  // 16
  const field: FieldRoundData = { players: [player('a', 'Alex', makeHoles([...front, ...back]))], totalHoles: 18 }
  assert.equal(findTheCollapse(field), null)
})

test('findTheCollapse — meaningful drop is correctly identified', () => {
  const front = new Array(9).fill(3) // 27
  const back = new Array(9).fill(1)  // 9
  const field: FieldRoundData = { players: [player('a', 'Alex', makeHoles([...front, ...back]))], totalHoles: 18 }
  const result = findTheCollapse(field)
  assert.equal(result?.playerId, 'a')
  assert.equal(result?.statLine, '27 out. 9 home.')
})

test('findBirdieHunter — counts gross score one under par, not Stableford points', () => {
  const holes: PlayerHoleResult[] = [
    { holeNumber: 1, stablefordPts: 3, grossScore: 3, par: 4 }, // birdie
    { holeNumber: 2, stablefordPts: 2, grossScore: 4, par: 4 }, // par, not a birdie
    { holeNumber: 3, stablefordPts: 4, grossScore: 2, par: 3 }, // birdie (eagle territory but still one-under)
  ]
  const field: FieldRoundData = { players: [player('a', 'Alex', holes, 1)], totalHoles: 3 }
  const result = findBirdieHunter(field)
  assert.equal(result?.statLine, '2 birdies')
})

test('findWipeoutKing — counts zero-point holes', () => {
  const holes = makeHoles([0, 0, 1, 2, 0])
  const field: FieldRoundData = { players: [player('a', 'Alex', holes, 1)], totalHoles: 5 }
  const result = findWipeoutKing(field)
  assert.equal(result?.statLine, '3 wipes today')
})

test('findMrConsistent — counts holes scoring 2+ points', () => {
  const holes = makeHoles([2, 3, 1, 0, 2, 4])
  const field: FieldRoundData = { players: [player('a', 'Alex', holes, 1)], totalHoles: 6 }
  const result = findMrConsistent(field)
  assert.equal(result?.statLine, '4 holes of 2 points or better')
})

test('findRoundPerformer — highest total Stableford', () => {
  const a = player('a', 'Alex', makeHoles([2, 2, 2]))
  const b = player('b', 'Dave', makeHoles([3, 3, 3]))
  const field: FieldRoundData = { players: [a, b], totalHoles: 3 }
  const result = findRoundPerformer(field)
  assert.equal(result?.playerId, 'b')
  assert.equal(result?.statLine, '9 Stableford points')
})

test('incomplete rounds are excluded from every category', () => {
  const incomplete = player('a', 'Alex', makeHoles([9, 9, 9])) // only 3 of 9 holes
  const field: FieldRoundData = { players: [incomplete], totalHoles: 9 }
  assert.equal(findHotStart(field), null)
  assert.equal(findRoundPerformer(field), null)
  assert.equal(findWipeoutKing(field), null)
})

test('findHoleFromHell — needs at least two completed players to compute a field average', () => {
  const field: FieldRoundData = { players: [player('a', 'Alex', makeHoles([0, 1, 2]))], totalHoles: 3 }
  assert.equal(findHoleFromHell(field), null)
})

test('findHoleFromHell — identifies a wipe against a strong field average', () => {
  const a = player('a', 'Alex', makeHoles([0, 2, 2]))
  const b = player('b', 'Dave', makeHoles([3, 2, 2]))
  const c = player('c', 'Mick', makeHoles([3, 2, 2]))
  const field: FieldRoundData = { players: [a, b, c], totalHoles: 3 }
  const result = findHoleFromHell(field)
  assert.equal(result?.playerId, 'a')
  assert.match(result?.statLine ?? '', /Field average: 2\.0 pts/)
})

test('findOneThatGotAway — needs at least three completed players', () => {
  const a = player('a', 'Alex', makeHoles([3, 3, 3, 3, 3, 3, 0, 0, 0]))
  const b = player('b', 'Dave', makeHoles([1, 1, 1, 1, 1, 1, 3, 3, 3]))
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  assert.equal(findOneThatGotAway(field), null)
})

test('findOneThatGotAway — identifies a genuine late fall', () => {
  // Player leads through the early snapshot, then collapses late while
  // BOTH others pass them — a genuine multi-place drop (1st -> 3rd),
  // not just a one-place slide (which the >= 2 threshold deliberately
  // excludes as normal round variance, not "the one that got away").
  const a = player('a', 'Mick', makeHoles([4, 4, 4, 4, 4, 0, 0, 0, 0])) // 20 total, led early
  const b = player('b', 'Dave', makeHoles([1, 1, 1, 1, 1, 4, 4, 4, 4]))  // 21 total, overtakes late
  const c = player('c', 'Alex', makeHoles([1, 1, 1, 1, 1, 4, 4, 4, 4]))  // 21 total, also overtakes late
  const field: FieldRoundData = { players: [a, b, c], totalHoles: 9 }
  const result = findOneThatGotAway(field)
  assert.equal(result?.playerId, 'a')
})

test('generateMakersAndBreakers — never generates more than 6 of each', () => {
  const players = [
    player('a', 'Alex', makeHoles(new Array(18).fill(2))),
    player('b', 'Dave', makeHoles(new Array(18).fill(3))),
    player('c', 'Mick', makeHoles(new Array(18).fill(1))),
  ]
  const field: FieldRoundData = { players, totalHoles: 18 }
  const { makers, breakers } = generateMakersAndBreakers(field)
  assert.ok(makers.length <= 6)
  assert.ok(breakers.length <= 6)
})

test('generateMakersAndBreakers — 9-hole event correctly omits Back Nine King and The Collapse', () => {
  const players = [
    player('a', 'Alex', makeHoles([2, 2, 2, 2, 2, 2, 2, 2, 2])),
    player('b', 'Dave', makeHoles([3, 3, 3, 3, 3, 3, 3, 3, 3])),
  ]
  const field: FieldRoundData = { players, totalHoles: 9 }
  const { makers, breakers } = generateMakersAndBreakers(field)
  assert.ok(!makers.some(m => m.category === 'back_nine_king'))
  assert.ok(!breakers.some(b => b.category === 'the_collapse'))
})
