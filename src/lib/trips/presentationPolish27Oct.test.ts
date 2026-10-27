import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPresentationDeck, defaultPresentationConfig } from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'
import { summariseRoundPlay, isPresentableRound } from './roundPlay'

const player = readFileSync(join(process.cwd(), 'src/components/memories/EventHighlightsPlayer.tsx'), 'utf8')
const audioHook = readFileSync(join(process.cwd(), 'src/components/memories/usePresentationAudio.ts'), 'utf8')

function fieldOf(n: number, tieFrom = Infinity): EventMemoryData {
  const rows = Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i + 1}`, roundPoints: 50 - i, totalPoints: 100 - i, position: i + 1 >= tieFrom ? tieFrom : i + 1 }))
  return {
    event: { id: 't', name: 'Field', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-25', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [1, 2].map(o => ({ id: `r${o}`, ordinal: o, name: `Round ${o}`, courseName: 'C', playDate: '2026-10-24', status: 'completed', holes: 18, hasRecordedScores: true,
      publishedHighlights: [], winners: [{ playerId: 'p0', playerName: 'Player 1', roundPoints: 50 }], standings: rows.map(r => ({ playerId: r.playerId, playerName: r.playerName, roundPoints: r.roundPoints, position: r.position })),
      cumulativeStandings: rows.map(r => ({ playerId: r.playerId, playerName: r.playerName, totalPoints: r.totalPoints, position: r.position })), cumulativeRoundsIncluded: o })) as never,
    memories: [], sideGameWinners: [], sideGameCount: 0, playerCount: n,
    results: { champion: { champions: [{ playerId: 'p0', playerName: 'Player 1', totalPoints: 100 }], hasTie: false, standings: rows.map(r => ({ playerId: r.playerId, playerName: r.playerName, totalPoints: r.totalPoints, position: r.position })) } },
  } as unknown as EventMemoryData
}
const decks = (d: EventMemoryData) => buildPresentationDeck(d, defaultPresentationConfig(d, { kind: 'fullEvent' })).slides

for (const n of [2, 20, 50]) {
  test(`${n}-player event: every results / total / final slide shows at most five ranked players (min(n,5))`, () => {
    const slides = decks(fieldOf(n))
    const lists = slides.flatMap(s => s.kind === 'roundResults' || s.kind === 'cumulativeResults' ? [s.standings] : s.kind === 'leaderboard' ? [s.entries] : [])
    assert.ok(lists.length >= 3, 'round results, totals and final leaderboard all present')
    for (const l of lists) assert.equal(l.length, Math.min(n, 5))
  })
}
test('50 players tied across fifth place: no false rank, tie group left out with a note', () => {
  const slides = decks(fieldOf(50, 4))
  const lb = slides.find(s => s.kind === 'leaderboard') as { entries: { position: number }[]; moreTied: { position: number; count: number } | null }
  assert.deepEqual(lb.entries.map(e => e.position), [1, 2, 3]); assert.deepEqual(lb.moreTied, { position: 4, count: 47 })
})

test('played-versus-unplayed is decided by recorded self entries, never by zero points', () => {
  const zeros = (cap: string) => [{ playerId: 'a', playerName: 'A', entries: [{ stableford_pts: 0, capture_role: cap }, { stableford_pts: 0, capture_role: cap }] }]
  const played = summariseRoundPlay(zeros('self'))
  assert.equal(played.hasRecordedScores, true); assert.equal(played.results.length, 1); assert.equal(played.results[0].roundPoints, 0)
  assert.equal(summariseRoundPlay([{ playerId: 'a', playerName: 'A', entries: [] }, { playerId: 'b', playerName: 'B', entries: [] }]).hasRecordedScores, false)
  assert.equal(summariseRoundPlay(zeros('marker')).hasRecordedScores, false, 'marker-only entries are not self-recorded play')
  assert.equal(isPresentableRound({ status: 'cancelled', hasRecordedScores: true }), false)
  assert.equal(isPresentableRound({ status: 'completed', hasRecordedScores: false }), false)
  assert.equal(isPresentableRound({ status: 'completed', hasRecordedScores: true }), true)
  assert.equal(isPresentableRound({ status: 'completed' }), true, 'older manifests without the flag keep working')
})
test('only players who recorded scores are ranked (a no-show is not a joint winner)', () => {
  const r = summariseRoundPlay([
    { playerId: 'a', playerName: 'A', entries: [{ stableford_pts: 3, capture_role: 'self' }] },
    { playerId: 'b', playerName: 'B', entries: [] },
  ])
  assert.deepEqual(r.results.map(x => x.playerId), ['a'])
})

test('music is OFF by default and only an explicit "on" is remembered for the session', () => {
  assert.match(audioHook, /const INITIAL: AudioState = \{ musicEnabled: false/)
  assert.match(audioHook, /getItem\(MUSIC_PREF_KEY\) === 'on'/)
  assert.match(audioHook, /catch \{ return false \}/)
  assert.match(audioHook, /writeMusicPref\(next\)/, 'manual toggle still persists for the session')
})

test('presentation type scales with the stage: the redesigned slides carry no small fixed-px font sizes', () => {
  const from = player.indexOf("if (slide.kind === 'sideGameWinner')"), to = player.indexOf("if (slide.kind === 'bloopersDivider')")
  const region = player.slice(from, to)
  const literal = [...region.matchAll(/fontSize: (\d+(?:\.\d+)?)[,\s}]/g)].map(m => Number(m[1]))
  assert.deepEqual(literal, [], `fixed px sizes found: ${literal.join(',')}`)
  assert.match(player, /const sz = \(min: number, cqw: number, max: number\) => `clamp\(\$\{min\}px, \$\{cqw\}cqw, \$\{max\}px\)`/)
  assert.doesNotMatch(player, /navigator\.userAgent/, 'no user-agent sniffing')
})
test('results slides name the winner only when position 1 and render the tie note', () => {
  assert.match(player, /moreTiedText\(slide\.moreTied\)/)
  assert.equal((player.match(/>Round Winner<\/span>/g) ?? []).length, 1)
})
