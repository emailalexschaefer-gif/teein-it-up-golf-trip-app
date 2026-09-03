import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getPlayedSequence, findHotStart, findBackNineKing,
  findBirdieHunter, findMrConsistent, findRoundPerformer,
  findWipeoutKing, findTheCollapse,
  findHoleFromHell, findOneThatGotAway, findMaverick, generateMakersAndBreakers,
  findBackNineBandits, findTheClosers, findTheFortress, findTheBirdcage, findDreamTeam,
  findWheelsOff, findDamageReport, findDeepFreeze, findStillInCarPark, findBackNineBreakdown, findRollercoaster,
  buildCourseReport,
  type FieldRoundData, type PlayerRoundData, type PlayerHoleResult,
} from './makersBreakers'

function makeHoles(pts: number[], par = 4, startGross = 4): PlayerHoleResult[] {
  return pts.map((p, i) => ({ holeNumber: i + 1, stablefordPts: p, grossScore: startGross, par }))
}

function player(id: string, name: string, holes: PlayerHoleResult[], startingHole = 1, groupId: string | null = null, groupName = ''): PlayerRoundData {
  return { playerId: id, playerName: name, startingHole, holes, groupId, groupName }
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

// ── Fixture A from the brief — Iceman vs Maverick, the two archetypes
// explicitly designed as near-opposites of each other. Both players
// present in the SAME field, deliberately, so this proves the two
// selection criteria don't accidentally overlap or misfire on the
// other player's pattern. ──

test('Fixture A — Iceman vs Maverick: consistent player gets Iceman, wild player gets Maverick', () => {
  // Player A: steady AND high-scoring throughout — no wipes, no
  // standout single-hole highs, just solid golf on every hole. Total
  // deliberately at/above Player B's, since findMrConsistent's
  // median-total filter (with only 2 players in the field) excludes
  // whichever total is lower — the "respectable performance"
  // threshold the brief itself requires, not an accident of this
  // fixture's specific numbers.
  const steady = player('a', 'Player A', makeHoles([3, 3, 3, 3, 3, 3, 3, 3, 3]))
  // Player B: exactly the brief's own example pattern — big highs
  // alternating with total wipes. Lower total than Player A, but that
  // is the point: Maverick rewards the SHAPE of the round, not the
  // total.
  const wild = player('b', 'Player B', makeHoles([4, 0, 3, 0, 4, 1, 4, 0, 3]))
  const field: FieldRoundData = { players: [steady, wild], totalHoles: 9 }

  const iceman = findMrConsistent(field)
  assert.equal(iceman?.playerId, 'a')

  const maverick = findMaverick(field)
  assert.equal(maverick?.playerId, 'b')
  // Confirms Maverick was NOT also awarded to the steady player, and
  // Iceman was NOT also awarded to the wild player — genuinely
  // distinct selection criteria, not the same metric read two ways.
  assert.notEqual(iceman?.playerId, maverick?.playerId)
})

test('findMaverick — a player who simply played badly all day (no genuine highs) does not qualify', () => {
  const consistentlyBad = player('a', 'Player A', makeHoles([0, 1, 0, 1, 0, 1, 0, 1, 0]))
  const field: FieldRoundData = { players: [consistentlyBad], totalHoles: 9 }
  const result = findMaverick(field)
  assert.equal(result, null)
})

test('findMaverick — an unusually good, uneventful round (no genuine lows) does not qualify', () => {
  const consistentlyGood = player('a', 'Player A', makeHoles([3, 4, 3, 4, 3, 4, 3, 4, 3]))
  const field: FieldRoundData = { players: [consistentlyGood], totalHoles: 9 }
  const result = findMaverick(field)
  assert.equal(result, null)
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

// ── The 11 previously missing archetypes — deterministic fixtures,
// each designed against the exact threshold the function itself uses. ──

test('findBackNineBandits — qualifying group on back nine (18-hole only)', () => {
  const front = makeHoles([1, 1, 1, 1, 1, 1, 1, 1, 1])
  const back = makeHoles([2, 2, 2, 2, 2, 2, 2, 2, 2]).map(h => ({ ...h, holeNumber: h.holeNumber + 9 }))
  const a = player('a', 'Alex', [...front, ...back], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...front, ...back], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findBackNineBandits(field)
  assert.equal(result?.groupId, 'g1')
})

test('findBackNineBandits — returns null on a 9-hole round', () => {
  const a = player('a', 'Alex', makeHoles([4, 4, 4, 4, 4, 4, 4, 4, 4]), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles([4, 4, 4, 4, 4, 4, 4, 4, 4]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  assert.equal(findBackNineBandits(field), null)
})

test('findTheClosers — qualifying group over the closing 3 holes', () => {
  const early = makeHoles([1, 1, 1, 1, 1, 1])
  const closing = makeHoles([3, 3, 3]).map(h => ({ ...h, holeNumber: h.holeNumber + 6 }))
  const a = player('a', 'Alex', [...early, ...closing], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...early, ...closing], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findTheClosers(field)
  assert.equal(result?.groupId, 'g1')
})

// 3 Sep field-test package, item 6 — "the missing information is WHO
// the group actually is." Group Makers & Breakers generation itself
// passed real-device testing and is explicitly protected from rewrite
// in this pass — this only covers the new roster field now surfaced
// on the returned Highlight, using the brief's own real example
// ("THE CLOSERS... 7.7 pt player average over the closing 3").
test('findTheClosers — roster lists exactly the players who comprised that group, by id and name', () => {
  const early = makeHoles([1, 1, 1, 1, 1, 1])
  const closing = makeHoles([3, 3, 3]).map(h => ({ ...h, holeNumber: h.holeNumber + 6 }))
  const a = player('a', 'Alex', [...early, ...closing], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...early, ...closing], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findTheClosers(field)
  assert.ok(result?.roster)
  assert.equal(result!.roster!.length, 2)
  const rosterIds = result!.roster!.map(r => r.playerId).sort()
  assert.deepEqual(rosterIds, ['a', 'b'])
  const alexEntry = result!.roster!.find(r => r.playerId === 'a')
  assert.equal(alexEntry?.playerName, 'Alex')
})

test('findTheClosers — a player in a DIFFERENT group never appears in this group\u2019s roster', () => {
  const early = makeHoles([1, 1, 1, 1, 1, 1])
  const closing = makeHoles([3, 3, 3]).map(h => ({ ...h, holeNumber: h.holeNumber + 6 }))
  const a = player('a', 'Alex', [...early, ...closing], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...early, ...closing], 1, 'g1', 'Group 1')
  // A third player in a separate group, with an even stronger closing
  // stretch — must never leak into Group 1's own roster.
  const c = player('c', 'Sam', makeHoles([1, 1, 1, 1, 1, 1, 4, 4, 4]), 1, 'g2', 'Group 2')
  const field: FieldRoundData = { players: [a, b, c], totalHoles: 9 }
  const result = findTheClosers(field)
  const rosterIds = result?.roster?.map(r => r.playerId) ?? []
  assert.ok(!rosterIds.includes('c'))
})

test('findTheFortress — strong, consistent, wipe-free group qualifies', () => {
  const a = player('a', 'Alex', makeHoles(new Array(18).fill(2)), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles(new Array(18).fill(2)), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findTheFortress(field)
  assert.equal(result?.groupId, 'g1')
})

test('findTheFortress — group with too many wipes does not qualify', () => {
  const a = player('a', 'Alex', makeHoles([0, 0, 0, 0, 3, 3, 3, 3, 3]), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles([0, 0, 0, 0, 3, 3, 3, 3, 3]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  assert.equal(findTheFortress(field), null)
})

test('findTheBirdcage — combined group birdies meet the minimum', () => {
  const aHoles = makeHoles([2, 2, 2, 2], 4).map((h, i) => (i < 2 ? { ...h, grossScore: h.par - 1 } : h))
  const bHoles = makeHoles([2, 2, 2, 2], 4).map((h, i) => (i === 0 ? { ...h, grossScore: h.par - 1 } : h))
  const a = player('a', 'Alex', aHoles, 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', bHoles, 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 4 }
  const result = findTheBirdcage(field)
  assert.equal(result?.statLine, '3 combined birdies')
})

test('findDreamTeam — strong average with low spread qualifies', () => {
  const a = player('a', 'Alex', makeHoles(new Array(18).fill(2)), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles(new Array(18).fill(2)), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findDreamTeam(field)
  assert.equal(result?.groupId, 'g1')
})

test('findDreamTeam — wide spread between members does not qualify', () => {
  const a = player('a', 'Alex', makeHoles(new Array(18).fill(3)), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles(new Array(18).fill(0)), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  assert.equal(findDreamTeam(field), null)
})

test('findWheelsOff — significant group front-to-back collapse qualifies (18-hole only)', () => {
  const front = makeHoles([3, 3, 3, 3, 3, 3, 3, 3, 3])
  const back = makeHoles([1, 1, 1, 1, 1, 1, 1, 1, 1]).map(h => ({ ...h, holeNumber: h.holeNumber + 9 }))
  const a = player('a', 'Alex', [...front, ...back], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...front, ...back], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findWheelsOff(field)
  assert.equal(result?.groupId, 'g1')
})

test('findDamageReport — group with normalised wipes-per-player above threshold qualifies', () => {
  const a = player('a', 'Alex', makeHoles([0, 0, 3, 3, 3, 3, 3, 3, 3]), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles([0, 0, 3, 3, 3, 3, 3, 3, 3]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findDamageReport(field)
  assert.equal(result?.statLine, '4 wipes between them')
})

test('findDeepFreeze — worst consecutive group window is identified (9-hole window = 3)', () => {
  const a = player('a', 'Alex', makeHoles([3, 3, 3, 0, 0, 0, 3, 3, 3]), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles([3, 3, 3, 0, 0, 0, 3, 3, 3]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findDeepFreeze(field)
  assert.equal(result?.groupId, 'g1')
})

test('findStillInCarPark — sufficiently poor group opening 3 holes qualifies', () => {
  const opening = makeHoles([1, 1, 1])
  const rest = makeHoles([3, 3, 3, 3, 3, 3]).map(h => ({ ...h, holeNumber: h.holeNumber + 3 }))
  const a = player('a', 'Alex', [...opening, ...rest], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...opening, ...rest], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const result = findStillInCarPark(field)
  assert.equal(result?.groupId, 'g1')
})

test('findStillInCarPark — a merely average opening does not qualify', () => {
  const a = player('a', 'Alex', makeHoles(new Array(9).fill(2)), 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', makeHoles(new Array(9).fill(2)), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  assert.equal(findStillInCarPark(field), null)
})

test('findBackNineBreakdown — objectively poor back nine qualifies regardless of front-nine collapse (18-hole only)', () => {
  const front = makeHoles([1, 1, 1, 1, 1, 1, 1, 1, 1])
  const back = makeHoles([1, 1, 1, 1, 1, 1, 1, 1, 1]).map(h => ({ ...h, holeNumber: h.holeNumber + 9 }))
  const a = player('a', 'Alex', [...front, ...back], 1, 'g1', 'Group 1')
  const b = player('b', 'Dave', [...front, ...back], 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a, b], totalHoles: 18 }
  const result = findBackNineBreakdown(field)
  assert.equal(result?.groupId, 'g1')
  // No front-to-back drop here (front === back), which is exactly the
  // distinction from Wheels Off — an objectively poor back nine, not
  // a collapse from a stronger front nine.
  assert.equal(findWheelsOff(field), null)
})

test('findRollercoaster — repeated alternation between good and poor outcomes qualifies', () => {
  const a = player('a', 'Alex', makeHoles([4, 0, 4, 0, 4, 0, 4, 0, 4]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a], totalHoles: 9 }
  const result = findRollercoaster(field)
  assert.equal(result?.playerId, 'a')
})

test('findRollercoaster — a single big swing (not repeated) does not qualify', () => {
  const a = player('a', 'Alex', makeHoles([2, 2, 2, 2, 2, 2, 2, 6, 2]), 1, 'g1', 'Group 1')
  const field: FieldRoundData = { players: [a], totalHoles: 9 }
  // One up-swing (2→6) followed by one down-swing (6→2) is a single
  // reversal, not "repeated" — genuinely has a swing, just not enough
  // of them, distinct from the zero-reversal case findMaverick's own
  // negative tests already cover.
  assert.equal(findRollercoaster(field), null)
})

// ── Post-round UX top-up — buildCourseReport extension. Item 16B
// (course statistics) and the 9-hole case from item 16C. ──

test('buildCourseReport — round winner, birdies, and wipes are correct', () => {
  // Alex: birdie on hole 1 (gross 3, par 4), wipe on hole 2 (0 pts).
  const alexHoles: PlayerHoleResult[] = [
    { holeNumber: 1, stablefordPts: 3, grossScore: 3, par: 4 },
    { holeNumber: 2, stablefordPts: 0, grossScore: 8, par: 4 },
    { holeNumber: 3, stablefordPts: 2, grossScore: 4, par: 4 },
  ]
  const daveHoles: PlayerHoleResult[] = [
    { holeNumber: 1, stablefordPts: 2, grossScore: 4, par: 4 },
    { holeNumber: 2, stablefordPts: 2, grossScore: 4, par: 4 },
    { holeNumber: 3, stablefordPts: 4, grossScore: 2, par: 4 }, // birdie x2 gross under par not needed — just one under par is enough (gross 2 vs par 4 is actually eagle, but birdieCount only checks par-1 exactly)
  ]
  const alex = player('alex', 'Alex', alexHoles)
  const dave = player('dave', 'Dave', daveHoles)
  const field: FieldRoundData = { players: [alex, dave], totalHoles: 3 }
  const parByHole = new Map([[1, 4], [2, 4], [3, 4]])
  const report = buildCourseReport(field, parByHole)

  // Alex: 3+0+2=5. Dave: 2+2+4=8. Dave wins.
  assert.equal(report.roundWinner?.playerId, 'dave')
  assert.equal(report.roundWinner?.totalPts, 8)
  // Only Alex's hole 1 is a genuine birdie (gross 3 = par-1). Dave's
  // hole 3 (gross 2) is an eagle, not counted by birdieCount's exact
  // par-1 definition — confirms this reuses findBirdieHunter's own
  // definition rather than a looser "under par" count.
  assert.equal(report.totalBirdies, 1)
  assert.equal(report.totalWipes, 1)
})

test('buildCourseReport — easiest and hardest holes correct', () => {
  const a = player('a', 'Alex', [
    { holeNumber: 1, stablefordPts: 4, grossScore: 3, par: 4 },
    { holeNumber: 2, stablefordPts: 0, grossScore: 8, par: 4 },
  ])
  const b = player('b', 'Dave', [
    { holeNumber: 1, stablefordPts: 4, grossScore: 3, par: 4 },
    { holeNumber: 2, stablefordPts: 1, grossScore: 6, par: 4 },
  ])
  const field: FieldRoundData = { players: [a, b], totalHoles: 2 }
  const parByHole = new Map([[1, 4], [2, 4]])
  const report = buildCourseReport(field, parByHole)
  assert.equal(report.easiestHole?.holeNumber, 1)
  assert.equal(report.hardestHole?.holeNumber, 2)
})

test('buildCourseReport — 9-hole round only considers holes actually belonging to that round', () => {
  const a = player('a', 'Alex', makeHoles([2, 2, 2, 2, 2, 2, 2, 2, 2]))
  const b = player('b', 'Dave', makeHoles([3, 3, 3, 3, 3, 3, 3, 3, 3]))
  const field: FieldRoundData = { players: [a, b], totalHoles: 9 }
  const parByHole = new Map(Array.from({ length: 9 }, (_, i) => [i + 1, 4]))
  const report = buildCourseReport(field, parByHole)
  // Neither easiest nor hardest hole can have a hole number beyond 9 —
  // proves the loop is genuinely bounded by field.totalHoles, not a
  // hardcoded 18.
  assert.ok((report.easiestHole?.holeNumber ?? 0) <= 9)
  assert.ok((report.hardestHole?.holeNumber ?? 0) <= 9)
  assert.equal(report.fieldAverage, (18 + 27) / 2)
})
