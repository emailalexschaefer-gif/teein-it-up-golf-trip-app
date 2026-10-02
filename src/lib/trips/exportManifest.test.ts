import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportManifest, sanitiseNameFragment, folderPathFor, type ExportMemory } from './exportManifest'
import { buildEventSummaryText } from './eventSummaryText'

function memory(overrides: Partial<ExportMemory> & { momentId: string }): ExportMemory {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerName: null, caption: null,
    imagePath: 'trip-1/general/user-1/1000.jpg', createdAt: '2026-09-11T10:00:00Z',
    organiserFavourite: false, sourceType: 'GENERAL', sideCompName: null,
    ...overrides,
  }
}

// -- sanitisation -----------------------------------------------------------

test('sanitiseNameFragment strips unsafe characters and converts spaces to hyphens', () => {
  assert.equal(sanitiseNameFragment('Alex Schaefer'), 'Alex-Schaefer')
  assert.equal(sanitiseNameFragment("D'Arcy O'Brien!!"), 'DArcy-OBrien')
})

test('sanitiseNameFragment strips accents to plain ASCII rather than dropping the character entirely', () => {
  assert.equal(sanitiseNameFragment('Rene Dupre'), 'Rene-Dupre')
})

test('sanitiseNameFragment returns empty string for input with nothing safe to keep -- callers must omit, not substitute', () => {
  assert.equal(sanitiseNameFragment('!!!'), '')
})

// -- folder structure ---------------------------------------------------

test('an event-level Memory (no round) goes under 00 - EVENT/GENERAL', () => {
  const m = memory({ momentId: 'm1', roundId: null })
  assert.equal(folderPathFor(m), '00 - EVENT/GENERAL')
})

test('a general round Memory goes under its own ordinal round folder', () => {
  const m = memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1 })
  assert.equal(folderPathFor(m), '01 - ROUND 1/GENERAL MOMENTS')
})

test('a Side Game Memory uses the real side_comps.name, not a hardcoded label, uppercased', () => {
  const m = memory({ momentId: 'm1', roundId: 'r2', roundOrdinal: 2, sourceType: 'SIDE_GAME', sideCompName: 'Longest Drive' })
  assert.equal(folderPathFor(m), '02 - ROUND 2/SIDE GAMES/LONGEST-DRIVE')
})

test('a custom Side Game name (not one of the standard types) still produces a real, correctly derived folder', () => {
  const m = memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, sourceType: 'SIDE_GAME', sideCompName: "Beat Daz's Drive" })
  assert.equal(folderPathFor(m), "01 - ROUND 1/SIDE GAMES/BEAT-DAZS-DRIVE")
})

// -- filenames ---------------------------------------------------------

test('a general round Memory filename includes round, hole, GENERAL, player', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, holeNumber: 4, playerName: 'Alex Schaefer' }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.equal(entry.filename, 'R01_H04_GENERAL_Alex-Schaefer_001.jpg')
})

test('a Side Game Memory filename uses the real Side Game name and marks FAVOURITE when set', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r2', roundOrdinal: 2, holeNumber: 7, playerName: 'Darren Smith', sourceType: 'SIDE_GAME', sideCompName: 'Longest Drive', organiserFavourite: true }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.equal(entry.filename, 'R02_H07_LONGEST-DRIVE_Darren-Smith_FAVOURITE_001.jpg')
})

test('an event-level Memory filename uses EVENT, not R00', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: null, playerName: 'Alex Schaefer' }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.match(entry.filename, /^EVENT_GENERAL_Alex-Schaefer_\d{3}\.jpg$/)
})

test('a Memory with no hole number omits the hole fragment entirely, never fabricating one', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, holeNumber: null, playerName: 'Alex' }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.doesNotMatch(entry.filename, /_H\d{2}_/)
})

test('a Memory with no player name omits the player fragment, never substituting "Unknown"', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, playerName: null }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.doesNotMatch(entry.filename.toLowerCase(), /unknown/)
})

test('file extension is preserved from the real storage path, case-normalised', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', imagePath: 'trip/round/user/123.PNG' }),
  ])
  const entry = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  assert.ok(entry.filename.endsWith('.png'))
})

// -- collision handling --------------------------------------------------

test('two Memories that would produce an identical base filename get sequential, deterministic numbers by chronological order', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, playerName: 'Alex', createdAt: '2026-09-11T10:00:00Z' }),
    memory({ momentId: 'm2', roundId: 'r1', roundOrdinal: 1, playerName: 'Alex', createdAt: '2026-09-11T10:05:00Z' }),
  ])
  const e1 = result.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!
  const e2 = result.entries.find(e => e.momentId === 'm2' && !e.isFavouriteDuplicate)!
  assert.match(e1.filename, /_001\./)
  assert.match(e2.filename, /_002\./)
})

test('running the builder twice on the same input produces byte-identical output -- fully deterministic', () => {
  const memories = [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, playerName: 'Alex', createdAt: '2026-09-11T10:00:00Z' }),
    memory({ momentId: 'm2', roundId: 'r1', roundOrdinal: 1, playerName: 'Alex', createdAt: '2026-09-11T10:05:00Z' }),
  ]
  const r1 = buildExportManifest('Test Event', { kind: 'all' }, memories)
  const r2 = buildExportManifest('Test Event', { kind: 'all' }, memories)
  assert.deepEqual(r1, r2)
})

// -- Favourite Highlights duplication -------------------------------------

test('a Favourite appears twice: once in its original context, once under 90 - FAVOURITE HIGHLIGHTS, with the identical filename', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r2', roundOrdinal: 2, holeNumber: 7, playerName: 'Darren', sourceType: 'SIDE_GAME', sideCompName: 'Longest Drive', organiserFavourite: true }),
  ])
  const originalEntries = result.entries.filter(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)
  const favouriteEntries = result.entries.filter(e => e.momentId === 'm1' && e.isFavouriteDuplicate)
  assert.equal(originalEntries.length, 1)
  assert.equal(favouriteEntries.length, 1)
  assert.equal(originalEntries[0].filename, favouriteEntries[0].filename)
  assert.equal(favouriteEntries[0].folderPath, '90 - FAVOURITE HIGHLIGHTS')
  assert.notEqual(originalEntries[0].folderPath, favouriteEntries[0].folderPath)
})

test('a non-Favourite never appears under 90 - FAVOURITE HIGHLIGHTS', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', organiserFavourite: false }),
  ])
  assert.equal(result.entries.filter(e => e.folderPath === '90 - FAVOURITE HIGHLIGHTS').length, 0)
})

test('favouriteCount and memoryCount do not double-count the Favourite Highlights duplicate', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', organiserFavourite: true }),
    memory({ momentId: 'm2', organiserFavourite: false }),
  ])
  assert.equal(result.memoryCount, 2)
  assert.equal(result.favouriteCount, 1)
})

// -- no empty folders (implicit -- only real entries are ever produced) ----

test('a no-photo event produces zero entries, not empty placeholder folders', () => {
  const result = buildExportManifest('Empty Event', { kind: 'all' }, [])
  assert.deepEqual(result.entries, [])
  assert.equal(result.memoryCount, 0)
})

// -- export scopes -------------------------------------------------------

test('Export Favourites includes only favourited Memories', () => {
  const result = buildExportManifest('Test Event', { kind: 'favourites' }, [
    memory({ momentId: 'm1', organiserFavourite: true }),
    memory({ momentId: 'm2', organiserFavourite: false }),
  ])
  const originals = result.entries.filter(e => !e.isFavouriteDuplicate)
  assert.equal(originals.length, 1)
  assert.equal(originals[0].momentId, 'm1')
})

test('Export Round includes only that rounds Memories', () => {
  const result = buildExportManifest('Test Event', { kind: 'round', roundId: 'r1' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1 }),
    memory({ momentId: 'm2', roundId: 'r2', roundOrdinal: 2 }),
  ])
  const originals = result.entries.filter(e => !e.isFavouriteDuplicate)
  assert.equal(originals.length, 1)
  assert.equal(originals[0].momentId, 'm1')
})

test('Export Selected includes only the explicitly listed moment IDs', () => {
  const result = buildExportManifest('Test Event', { kind: 'selected', momentIds: ['m2'] }, [
    memory({ momentId: 'm1' }),
    memory({ momentId: 'm2' }),
    memory({ momentId: 'm3' }),
  ])
  const originals = result.entries.filter(e => !e.isFavouriteDuplicate)
  assert.equal(originals.length, 1)
  assert.equal(originals[0].momentId, 'm2')
})

test('Export Round still produces a Favourite Highlights duplicate scoped to that rounds own favourites only', () => {
  const result = buildExportManifest('Test Event', { kind: 'round', roundId: 'r1' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, organiserFavourite: true }),
    memory({ momentId: 'm2', roundId: 'r2', roundOrdinal: 2, organiserFavourite: true }),
  ])
  const favouriteEntries = result.entries.filter(e => e.isFavouriteDuplicate)
  assert.equal(favouriteEntries.length, 1)
  assert.equal(favouriteEntries[0].momentId, 'm1')
})

// -- proxy capture / long names ---------------------------------------------

test('excessively long player/event names are truncated, never producing an unsafe-length filename', () => {
  const result = buildExportManifest('Test Event', { kind: 'all' }, [
    memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, playerName: 'A'.repeat(300) }),
  ])
  const entry = result.entries.find(e => !e.isFavouriteDuplicate)!
  assert.ok(entry.filename.length < 250)
})

// -- EVENT-SUMMARY.txt -------------------------------------------------

test('buildEventSummaryText never mentions a champion as fact -- only the explicit not available line', () => {
  const memories: ExportMemory[] = [memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1 })]
  const exportResult = buildExportManifest('Test Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Test Event', startDate: '2026-09-11', endDate: '2026-09-12', playerCount: 4 },
    [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-09-11' }],
    memories, [], exportResult,
  )
  assert.match(text, /Champion: not available in this export\./)
  assert.doesNotMatch(text, /Champion: [A-Z]/) // never a real name claimed
})

test('buildEventSummaryText omits the Favourite Highlights section entirely when there are no favourites', () => {
  const memories: ExportMemory[] = [memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, organiserFavourite: false })]
  const exportResult = buildExportManifest('Test Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Test Event', startDate: null, endDate: null, playerCount: 2 },
    [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: null, playDate: null }],
    memories, [], exportResult,
  )
  assert.doesNotMatch(text, /FAVOURITE HIGHLIGHTS/)
})

test('buildEventSummaryText includes the exact exported filename for a Favourite, matching the ZIP', () => {
  const memories: ExportMemory[] = [memory({ momentId: 'm1', roundId: 'r1', roundOrdinal: 1, playerName: 'Alex', organiserFavourite: true })]
  const exportResult = buildExportManifest('Test Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Test Event', startDate: null, endDate: null, playerCount: 1 },
    [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: null, playDate: null }],
    memories, [], exportResult,
  )
  const expectedFilename = exportResult.entries.find(e => e.momentId === 'm1' && !e.isFavouriteDuplicate)!.filename
  assert.ok(text.includes(expectedFilename))
})

test('buildEventSummaryText reports no Memories captured for a round with none, rather than an empty, confusing section', () => {
  const memories: ExportMemory[] = []
  const exportResult = buildExportManifest('Test Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Test Event', startDate: null, endDate: null, playerCount: 0 },
    [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: null, playDate: null }],
    memories, [], exportResult,
  )
  assert.match(text, /No Memories captured for this round/)
})

// -- Event Memories V1.3 (13 Sep): championResult in the summary --

test('buildEventSummaryText: with no championResult, still says Champion: not available (unchanged default behaviour)', () => {
  const memories = [memory({ momentId: 'a' })]
  const exportResult = buildExportManifest('Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Event', startDate: null, endDate: null, playerCount: 1 },
    [], memories, [], exportResult,
  )
  assert.match(text, /Champion: not available in this export/)
})

test('buildEventSummaryText: with a real championResult, prints the champion name, score, and full final standings -- never "not available"', () => {
  const memories = [memory({ momentId: 'a' })]
  const exportResult = buildExportManifest('Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Event', startDate: null, endDate: null, playerCount: 2 },
    [], memories, [], exportResult,
    {
      champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }],
      hasTie: false,
      standings: [
        { playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 },
        { playerId: 'p2', playerName: 'Alex Schaefer', totalPoints: 68, position: 2 },
      ],
    },
  )
  assert.match(text, /Champion: Darren Lappen/)
  assert.match(text, /Winning Score: 72 points/)
  assert.match(text, /FINAL STANDINGS/)
  assert.match(text, /1\. Darren Lappen/)
  assert.match(text, /2\. Alex Schaefer/)
  assert.doesNotMatch(text, /not available in this export/)
})

test('buildEventSummaryText: a tied championResult shows both names and marks the tie, never picking one arbitrarily', () => {
  const memories = [memory({ momentId: 'a' })]
  const exportResult = buildExportManifest('Event', { kind: 'all' }, memories)
  const text = buildEventSummaryText(
    { name: 'Event', startDate: null, endDate: null, playerCount: 2 },
    [], memories, [], exportResult,
    {
      champions: [{ playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72 }, { playerId: 'p2', playerName: 'Alex Schaefer', totalPoints: 72 }],
      hasTie: true,
      standings: [
        { playerId: 'p1', playerName: 'Darren Lappen', totalPoints: 72, position: 1 },
        { playerId: 'p2', playerName: 'Alex Schaefer', totalPoints: 72, position: 1 },
      ],
    },
  )
  assert.match(text, /Darren Lappen & Alex Schaefer/)
  assert.match(text, /\(tie\)/)
})
