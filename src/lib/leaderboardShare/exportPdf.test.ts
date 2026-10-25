import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLeaderboardPdf, toWinAnsi, pdfLiteral, textWidth } from './exportPdf'
import { fixtureBoard } from './boardFixtures'

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')
const pageCount = (s: string) => Number(/\/Type \/Pages \/Count (\d+)/.exec(s)![1])

/** Every xref entry must point at exactly "N 0 obj"; startxref must point at "xref". */
function assertStructure(bytes: Uint8Array) {
  const s = text(bytes)
  assert.ok(s.startsWith('%PDF-1.4\n')); assert.ok(s.trimEnd().endsWith('%%EOF'))
  const sx = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1])
  assert.equal(s.slice(sx, sx + 4), 'xref')
  const m = /xref\n0 (\d+)\n/.exec(s.slice(sx))!
  const n = Number(m[1])
  const entries = s.slice(sx + m[0].length).split('\n').slice(0, n)
  assert.equal(entries[0], '0000000000 65535 f ')
  for (let i = 1; i < n; i++) {
    const off = Number(entries[i].slice(0, 10))
    assert.equal(s.slice(off, off + `${i} 0 obj`.length), `${i} 0 obj`, `object ${i}`)
  }
  for (const b of bytes) assert.ok(b === 10 || (b >= 32 && b <= 126), 'ASCII only')
}

for (const n of [0, 2, 20, 50, 120]) {
  test(`PDF for ${n} players is structurally valid, ASCII-only, and every player appears once`, () => {
    const bytes = buildLeaderboardPdf(fixtureBoard(n), { generatedText: 'Generated test' })
    assertStructure(bytes)
    const s = text(bytes)
    const pages = pageCount(s)
    if (n <= 2) assert.equal(pages, 1)
    if (n >= 50) assert.ok(pages >= 2, `50+ players must paginate, got ${pages}`)
    assert.equal((s.match(/\/Type \/Page /g) ?? []).length, pages)
    for (let p = 1; p <= pages; p++) assert.ok(s.includes(`(Page ${p} of ${pages})`), `footer page ${p}`)
    for (let i = 1; i <= n; i++) assert.equal(s.split(`(Player Number ${i} Surname)`).length - 1, 1, `player ${i}`)
  })
}

test('PDF repeats the table header on continuation pages', () => {
  const s = text(buildLeaderboardPdf(fixtureBoard(120)))
  assert.equal((s.match(/\(PLAYER\)/g) ?? []).length, pageCount(s))
})

test('live PDF has THRU; final PDF does not; multi-round has R columns', () => {
  assert.ok(text(buildLeaderboardPdf(fixtureBoard(3, 'live'))).includes('(THRU)'))
  assert.equal(text(buildLeaderboardPdf(fixtureBoard(3, 'final'))).includes('(THRU)'), false)
  const s = text(buildLeaderboardPdf(fixtureBoard(3, 'final', 2)))
  assert.ok(s.includes('(R1)') && s.includes('(R2)'))
})

test('text encoding: WinAnsi maps accents and smart punctuation; unsupported characters become "?"; PDF escapes ( ) \\', () => {
  assert.deepEqual(toWinAnsi('Seán'), [83, 101, 0xe1, 110])
  assert.deepEqual(toWinAnsi('’'), [0x92])
  assert.deepEqual(toWinAnsi('中'), [63])
  assert.deepEqual(toWinAnsi('\u{1F600}'), [63, 63].slice(0, toWinAnsi('\u{1F600}').length))
  const lit = pdfLiteral(toWinAnsi('A(b)\\c'))
  assert.equal(lit, '(A\\(b\\)\\\\c)')
})

test('awkward names (accents, parentheses, backslash, very long) never corrupt the file', () => {
  const b = fixtureBoard(4)
  b.rows[0].name = 'Seán O’Brien (Jr) \\ Co'
  b.rows[1].name = 'Z'.repeat(60)
  b.rows[2].name = '中文 \u{1F600}'
  b.eventName = 'Lappen "Invitational" (2026) é'
  assertStructure(buildLeaderboardPdf(b))
})

test('long names are shortened to fit the column, not overlapped', () => {
  const b = fixtureBoard(1); b.rows[0].name = 'W'.repeat(60)
  const s = text(buildLeaderboardPdf(b))
  assert.equal(s.includes('(' + 'W'.repeat(60) + ')'), false)
  assert.ok(textWidth('W'.repeat(60), 10.5, true) > 300)
})
