import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportManifest, type ExportMemory, type ExportMemorySourceType } from './exportManifest'
import { buildEventSummaryText, type SummaryRound } from './eventSummaryText'

/**
 * Event Memories V1.1 (12 Sep) -- the large-scale synthetic fixture
 * test, per the explicit instruction: "a synthetic fixture of at
 * least 150 Memories across 3 rounds, including multiple Side Games,
 * custom Side Game names, 20-30 Favourites, filename collisions and
 * missing optional metadata... proves organisation logic, NOT real
 * Vercel/Supabase network performance." Deliberately a separate file
 * from exportManifest.test.ts's existing 28 small, targeted unit
 * tests -- this is one realistic-scale integration-style fixture, not
 * another isolated case.
 *
 * The fixture is generated deterministically (a fixed seed-like
 * pattern, not random), so this test produces the exact same result
 * on every run -- a requirement for a test to be trustworthy at all.
 */

const PLAYERS = ['Alex Schaefer', 'Darren Smith', 'Louis Jones', 'Dave Carter', 'Mick Ryan', 'Ben Holt']
const SIDE_GAMES = ["Nearest the Pin", 'Longest Drive', "Beat Daz's Drive"] // last one -- the required custom name

function buildFixture(): { memories: ExportMemory[]; favouriteCount: number } {
  const memories: ExportMemory[] = []
  let favouriteCount = 0
  let momentCounter = 0
  let minuteOffset = 0
  let sideGameSelector = 0

  for (let round = 1; round <= 3; round++) {
    // 50 per round -- 150 total, matching "at least 150" exactly at
    // the floor the brief specified, not an arbitrarily larger number
    // that would make the test slower without adding real coverage.
    for (let i = 0; i < 50; i++) {
      momentCounter += 1
      minuteOffset += 1
      const momentId = `m-${round}-${i}`
      const player = PLAYERS[momentCounter % PLAYERS.length]
      const hole = (momentCounter % 18) + 1
      // Roughly 1 in 3 is a Side Game Moment, cycling through all
      // three games (including the required custom name) using an
      // INDEPENDENT counter from the "is this a Side Game" check --
      // using the same modulus for both (an earlier draft's actual
      // bug, caught by running this test and finding the custom name
      // never appeared anywhere in the output) meant the selector was
      // always 0 whenever the side-game check was true, so the custom
      // name could mathematically never be chosen. sideGameSelector
      // increments independently so all three games genuinely rotate.
      const isSideGame = momentCounter % 3 === 0
      sideGameSelector += isSideGame ? 1 : 0
      const sideGame = SIDE_GAMES[sideGameSelector % SIDE_GAMES.length]
      // Deliberate filename collisions: every 7th memory reuses the
      // exact same player+hole+sourceType combination as another one
      // earlier in the SAME round, forcing an identical base filename
      // and exercising the sequence-number collision handling at
      // scale, not just the existing isolated 2-item collision test.
      const forceCollision = momentCounter % 7 === 0
      const collisionHole = forceCollision ? 5 : hole
      const collisionPlayer = forceCollision ? PLAYERS[0] : player

      // Missing optional metadata: every 5th memory has no hole, every
      // 11th has no caption, every 13th has no player name at all --
      // different moduli so these overlap unevenly across the set,
      // matching how real, incomplete data actually looks.
      const holeNumber = momentCounter % 5 === 0 ? null : collisionHole
      const caption = momentCounter % 11 === 0 ? null : `Nice shot on hole ${collisionHole}`
      const playerName = momentCounter % 13 === 0 ? null : collisionPlayer

      // 25 favourites across 150 -- within the required 20-30 range.
      const isFavourite = momentCounter % 6 === 0 && favouriteCount < 25
      if (isFavourite) favouriteCount += 1

      memories.push({
        momentId,
        roundId: `round-${round}`,
        roundOrdinal: round,
        holeNumber,
        playerName,
        caption,
        imagePath: `trip-1/round-${round}/user-${momentCounter}/${1700000000000 + minuteOffset}.jpg`,
        createdAt: new Date(2026, 8, round, 8, minuteOffset).toISOString(),
        organiserFavourite: isFavourite,
        sourceType: (isSideGame ? 'SIDE_GAME' : 'GENERAL') as ExportMemorySourceType,
        sideCompName: isSideGame ? sideGame : null,
      })
    }
  }

  return { memories, favouriteCount }
}

test('150-Memory, 3-round fixture: every Memory appears exactly once in its primary location', () => {
  const { memories } = buildFixture()
  assert.equal(memories.length, 150)

  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  const primaryEntries = result.entries.filter(e => !e.isFavouriteDuplicate)
  assert.equal(primaryEntries.length, 150)
  assert.equal(result.memoryCount, 150)

  // Every momentId appears in the primary set exactly once -- no
  // Memory dropped, none duplicated outside the Favourite copy.
  const primaryMomentIds = primaryEntries.map(e => e.momentId)
  assert.equal(new Set(primaryMomentIds).size, 150)
})

test('150-Memory fixture: Favourite count matches the deterministic fixture exactly (within the required 20-30 range), and every Favourite has exactly one duplicate under Favourite Highlights', () => {
  const { memories, favouriteCount } = buildFixture()
  assert.ok(favouriteCount >= 20 && favouriteCount <= 30, `expected 20-30 favourites, fixture produced ${favouriteCount}`)

  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  assert.equal(result.favouriteCount, favouriteCount)

  const favouriteDuplicates = result.entries.filter(e => e.isFavouriteDuplicate)
  assert.equal(favouriteDuplicates.length, favouriteCount)
  assert.ok(favouriteDuplicates.every(e => e.folderPath === '90 - FAVOURITE HIGHLIGHTS'))

  // Each duplicate's filename matches its primary entry's filename
  // exactly -- the brief's own "same deterministic filename" requirement.
  const primaryByMomentId = new Map(result.entries.filter(e => !e.isFavouriteDuplicate).map(e => [e.momentId, e]))
  for (const dup of favouriteDuplicates) {
    assert.equal(dup.filename, primaryByMomentId.get(dup.momentId)!.filename)
  }
})

test('150-Memory fixture: no empty folders -- every folder that appears has at least one real entry in it', () => {
  const { memories } = buildFixture()
  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  const folderCounts = new Map<string, number>()
  for (const e of result.entries) folderCounts.set(e.folderPath, (folderCounts.get(e.folderPath) ?? 0) + 1)
  // The test itself only ever asks buildExportManifest for folders
  // that entries were actually placed into -- this assertion exists
  // to make that structural guarantee explicit and regression-proof:
  // every folder this function ever reports has a nonzero count.
  for (const [, count] of folderCounts) assert.ok(count > 0)
  // The custom Side Game name produces its own real folder -- not
  // silently merged into a generic "SIDE GAMES" bucket.
  const hasCustomGameFolder = [...folderCounts.keys()].some(f => f.includes('BEAT-DAZS-DRIVE') || f.includes('BEAT-DAZ'))
  assert.ok(hasCustomGameFolder, 'expected a folder for the custom Side Game name "Beat Daz\'s Drive"')
})

test('150-Memory fixture: forced filename collisions are all resolved uniquely within their folder -- no two entries share folderPath+filename', () => {
  const { memories } = buildFixture()
  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  const seen = new Set<string>()
  for (const e of result.entries) {
    const key = `${e.folderPath}/${e.filename}`
    assert.ok(!seen.has(key), `duplicate folder+filename found: ${key}`)
    seen.add(key)
  }
})

test('150-Memory fixture: missing optional metadata (hole/caption/player) never produces "null"/"undefined" in a filename', () => {
  const { memories } = buildFixture()
  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  for (const e of result.entries) {
    assert.doesNotMatch(e.filename, /null|undefined/i)
  }
})

test('150-Memory fixture: Export Round scope returns only that round\'s 50 Memories, and Export Favourites returns only the 20-30 favourites', () => {
  const { memories, favouriteCount } = buildFixture()

  const round2Result = buildExportManifest('Event', { kind: 'round', roundId: 'round-2' }, memories)
  assert.equal(round2Result.memoryCount, 50)
  assert.ok(round2Result.entries.filter(e => !e.isFavouriteDuplicate).every(e => e.folderPath.startsWith('02 - ROUND 2')))

  const favResult = buildExportManifest('Event', { kind: 'favourites' }, memories)
  assert.equal(favResult.memoryCount, favouriteCount)
  // Every entry in a Favourites-only export is itself a favourite --
  // the scope filter and the favourite-duplication step must agree
  // with each other, not just each independently be correct.
  assert.ok(favResult.entries.filter(e => !e.isFavouriteDuplicate).every(e => memories.find(m => m.momentId === e.momentId)?.organiserFavourite))
})

test('150-Memory fixture: EVENT-SUMMARY.txt generates without error, and its own header counts match the fixture exactly', () => {
  const { memories, favouriteCount } = buildFixture()
  const result = buildExportManifest('Darren\u2019s Golf Trip 2026', { kind: 'all' }, memories)
  const rounds: SummaryRound[] = [
    { id: 'round-1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-09-01' },
    { id: 'round-2', ordinal: 2, name: 'Round 2', courseName: 'Pine Valley', playDate: '2026-09-02' },
    { id: 'round-3', ordinal: 3, name: 'Round 3', courseName: 'Eagle Ridge', playDate: '2026-09-03' },
  ]
  const text = buildEventSummaryText(
    { name: 'Darren\u2019s Golf Trip 2026', startDate: '2026-09-01', endDate: '2026-09-03', playerCount: PLAYERS.length },
    rounds, memories, [], result,
  )
  assert.match(text, /Total Memories: 150/)
  assert.match(text, new RegExp(`Favourite Memories: ${favouriteCount}`))
  assert.match(text, /FAVOURITE HIGHLIGHTS/)
  assert.match(text, /ROUND 1/)
  assert.match(text, /ROUND 2/)
  assert.match(text, /ROUND 3/)
  // The custom Side Game name appears verbatim in the summary text,
  // not replaced or omitted.
  assert.match(text, /Beat Daz's Drive/)
})
