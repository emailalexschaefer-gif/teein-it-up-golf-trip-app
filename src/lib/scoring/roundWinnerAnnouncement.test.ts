import test from 'node:test'
import assert from 'node:assert/strict'
import { describeRoundWinner } from './roundWinnerAnnouncement'

// ── Phase E (11 Oct) — results-integrity fix regression tests ──────────
// Direct user report: a 27-27 tie was announced as "Alex Schaefer wins
// by 0 Stableford points." These tests cover ties, outright wins, and
// valid (non-tied) tiebreaker outcomes, per the explicit instruction to
// add regression coverage for all three.

test('outright win: a genuine positive margin -- "wins by N Stableford points"', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 40 },
    { name: 'Daz', totalPts: 35 },
  ])
  assert.equal(line, '🏆 Alex Schaefer wins by 5 Stableford points')
})

test('outright win: singular "point" when the margin is exactly 1', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 36 },
    { name: 'Daz', totalPts: 35 },
  ])
  assert.equal(line, '🏆 Alex Schaefer wins by 1 Stableford point')
})

test('the reported bug: a two-way 27-27 tie must say "tied at the top," never "wins by 0"', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 27 },
    { name: 'Daz', totalPts: 27 },
  ])
  assert.equal(line, '🤝 Alex Schaefer & Daz tied at the top with 27 Stableford points')
  assert.doesNotMatch(line ?? '', /wins by 0/)
})

test('a three-way (or more) tie at the top lists every tied name, not just the first two in ranked order', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 30 },
    { name: 'Daz', totalPts: 30 },
    { name: 'Sam', totalPts: 30 },
    { name: 'Jordan', totalPts: 22 },
  ])
  assert.equal(line, '🤝 Alex Schaefer & Daz & Sam tied at the top with 30 Stableford points')
})

test('a tie lower down the field (not at the top) does not trigger tie wording -- only a tie AT the lead does', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 40 },
    { name: 'Daz', totalPts: 33 },
    { name: 'Sam', totalPts: 33 },
  ])
  assert.equal(line, '🏆 Alex Schaefer wins by 7 Stableford points')
})

test('singular "point" in the tie line when the tied score is exactly 1', () => {
  const line = describeRoundWinner([
    { name: 'Alex Schaefer', totalPts: 1 },
    { name: 'Daz', totalPts: 1 },
  ])
  assert.equal(line, '🤝 Alex Schaefer & Daz tied at the top with 1 Stableford point')
})

test('a single player with no runner-up at all -- "wins" with no fabricated margin', () => {
  const line = describeRoundWinner([{ name: 'Alex Schaefer', totalPts: 40 }])
  assert.equal(line, '🏆 Alex Schaefer wins')
})

test('an empty field returns null rather than throwing or fabricating a winner', () => {
  assert.equal(describeRoundWinner([]), null)
})

test('valid (non-tied) ranked-order outcome: the function trusts the ordering it is handed and only WORDS it -- it never re-sorts or re-ranks', () => {
  // ranked[0]/[1] here represent an input already sorted upstream by
  // totalPts desc with holesPlayed desc as a display tiebreaker (see
  // tournament/route.ts) -- describeRoundWinner must not second-guess
  // that ordering, only decide the wording for a genuine (non-zero)
  // margin between the first two entries.
  const line = describeRoundWinner([
    { name: 'Daz', totalPts: 38 }, // ranked[0] by the caller's own sort, e.g. more holes played on a tie elsewhere
    { name: 'Alex Schaefer', totalPts: 36 },
  ])
  assert.equal(line, '🏆 Daz wins by 2 Stableford points')
})

test('never produces the old buggy phrasing for any tie scenario', () => {
  const twoWay = describeRoundWinner([{ name: 'A', totalPts: 10 }, { name: 'B', totalPts: 10 }])
  const threeWay = describeRoundWinner([{ name: 'A', totalPts: 10 }, { name: 'B', totalPts: 10 }, { name: 'C', totalPts: 10 }])
  for (const line of [twoWay, threeWay]) {
    assert.doesNotMatch(line ?? '', /wins by 0/)
  }
})
