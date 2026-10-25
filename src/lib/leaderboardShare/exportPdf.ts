/**
 * Paginated leaderboard PDF. Pure, dependency-free and browser/Node safe.
 *
 * Deliberately simple so it is reliable on every phone and desktop viewer:
 *   - text + filled rectangles only (no images, no embedded fonts)
 *   - the standard Helvetica / Helvetica-Bold fonts every PDF reader has
 *   - WinAnsi text; characters outside it (e.g. emoji, non-Latin scripts) are
 *     replaced with "?" rather than producing a broken file
 *   - the whole file is ASCII (non-ASCII bytes are written as octal escapes),
 *     so byte offsets in the cross-reference table are exact
 * Any number of players: rows flow onto as many A4 pages as needed, with the
 * table header repeated on each page and "Page x of y" in the footer.
 */
import { positionText, type PublicBoard } from './publicBoard'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const ROW_H = 21
const TABLE_HEAD_H = 22
const FOOTER_H = 44
const BAND_H_FIRST = 96
const BAND_H_NEXT = 44

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]

// Characters outside Latin-1 that WinAnsi does include.
const WIN_EXTRA: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89,
  0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
}

/** Text -> WinAnsi byte values. Unsupported characters become "?" (one per code point). */
export function toWinAnsi(text: string): number[] {
  const out: number[] = []
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0) as number
    if (c === 0x09 || c === 0x0a || c === 0x0d) out.push(0x20)
    else if (c >= 0x20 && c <= 0x7e) out.push(c)
    else if (c >= 0xa0 && c <= 0xff) out.push(c)
    else if (WIN_EXTRA[c] !== undefined) out.push(WIN_EXTRA[c])
    else if (c === 0x200b || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue // zero-width / variation selectors
    else out.push(0x3f)
  }
  return out
}

/** A PDF literal string for already-WinAnsi bytes; every non-printable byte is an octal escape (ASCII-only output). */
export function pdfLiteral(bytes: number[]): string {
  let s = '('
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b)
    else if (b < 0x20 || b > 0x7e) s += '\\' + b.toString(8).padStart(3, '0')
    else s += String.fromCharCode(b)
  }
  return s + ')'
}

export function textWidth(text: string, size: number, bold: boolean): number {
  const table = bold ? W_BOLD : W_REG
  let w = 0
  for (const b of toWinAnsi(text)) w += b >= 32 && b <= 126 ? table[b - 32] : 556
  return (w * size) / 1000
}

function fit(text: string, size: number, bold: boolean, max: number): string {
  if (textWidth(text, size, bold) <= max) return text
  let t = text
  while (t.length > 1 && textWidth(t + '…', size, bold) > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

function wrap(text: string, size: number, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next, size, false) <= max || !line) line = next
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString()

class Page {
  ops: string[] = []
  rect(x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
    this.ops.push(`${f2(rgb[0])} ${f2(rgb[1])} ${f2(rgb[2])} rg ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re f`)
  }
  text(str: string, x: number, y: number, size: number, bold: boolean, rgb: [number, number, number], align: 'left' | 'right' = 'left') {
    const px = align === 'right' ? x - textWidth(str, size, bold) : x
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${f2(rgb[0])} ${f2(rgb[1])} ${f2(rgb[2])} rg ${f2(px)} ${f2(y)} Td ${pdfLiteral(toWinAnsi(str))} Tj ET`)
  }
}

const GREEN: [number, number, number] = [0.059, 0.176, 0.11]
const GOLD: [number, number, number] = [0.91, 0.788, 0.416]
const WHITE: [number, number, number] = [1, 1, 1]
const INK: [number, number, number] = [0.1, 0.1, 0.09]
const MUTED: [number, number, number] = [0.42, 0.42, 0.38]
const HEAD_BG: [number, number, number] = [0.965, 0.953, 0.918]
const STRIPE: [number, number, number] = [0.975, 0.972, 0.96]
const LEADER: [number, number, number] = [1, 0.984, 0.92]

export interface PdfOptions { generatedText?: string }

export function buildLeaderboardPdf(board: PublicBoard, opts: PdfOptions = {}): Uint8Array {
  const generatedText = opts.generatedText ?? `Generated ${new Date(board.generatedAt).toUTCString()}`
  const showThru = board.status === 'live'
  const pages: Page[] = []

  // Column geometry (right edges), numeric columns right-aligned.
  const right = PAGE_W - MARGIN
  const ptsRight = right
  let cursor = ptsRight - 40
  const roundRights = board.roundColumns.map(() => { const r = cursor; cursor -= 38; return r })
  roundRights.reverse() // leftmost round first
  const roundsLeft = board.roundColumns.length > 0 ? cursor + 38 - 30 : ptsRight - 40 - 30
  const thruRight = showThru ? roundsLeft - 8 : roundsLeft
  const thruW = showThru ? 54 : 0
  const nameX = MARGIN + 40
  const nameMax = thruRight - thruW - 10 - nameX

  function header(page: Page, first: boolean): number {
    const band = first ? BAND_H_FIRST : BAND_H_NEXT
    page.rect(0, PAGE_H - band, PAGE_W, band, GREEN)
    if (first) {
      page.text("TEEIN' IT UP", MARGIN, PAGE_H - 28, 10, true, GOLD)
      page.text(fit(board.eventName, 22, true, PAGE_W - MARGIN * 2), MARGIN, PAGE_H - 55, 22, true, WHITE)
      const sub = [board.statusLabel, board.roundLabel].filter(Boolean).join('  •  ')
      page.text(sub, MARGIN, PAGE_H - 78, 11, true, GOLD)
    } else {
      page.text(fit(board.eventName, 14, true, PAGE_W - MARGIN * 2), MARGIN, PAGE_H - 27, 14, true, WHITE)
    }
    let y = PAGE_H - band - 20
    if (first) { page.text(generatedText, MARGIN, y, 9, false, MUTED); y -= 26 }
    // table header
    page.rect(MARGIN - 6, y - 6, PAGE_W - (MARGIN - 6) * 2, TABLE_HEAD_H, HEAD_BG)
    const ty = y
    page.text('POS', MARGIN, ty, 8.5, true, MUTED)
    page.text('PLAYER', nameX, ty, 8.5, true, MUTED)
    if (showThru) page.text('THRU', thruRight, ty, 8.5, true, MUTED, 'right')
    board.roundColumns.forEach((c, i) => page.text(c.label, roundRights[i], ty, 8.5, true, MUTED, 'right'))
    page.text('PTS', ptsRight, ty, 8.5, true, MUTED, 'right')
    return y - TABLE_HEAD_H - 6
  }

  let page = new Page(); pages.push(page)
  let y = header(page, true)
  const bottom = FOOTER_H + 10

  if (board.rows.length === 0) {
    for (const line of wrap(board.note ?? 'No scores yet.', 11, PAGE_W - MARGIN * 2)) { page.text(line, MARGIN, y, 11, false, MUTED); y -= 16 }
  }

  board.rows.forEach((r, i) => {
    if (y - ROW_H < bottom) { page = new Page(); pages.push(page); y = header(page, false) }
    const top = y + 14
    if (r.position === 1) page.rect(MARGIN - 6, top - ROW_H, PAGE_W - (MARGIN - 6) * 2, ROW_H, LEADER)
    else if (i % 2 === 1) page.rect(MARGIN - 6, top - ROW_H, PAGE_W - (MARGIN - 6) * 2, ROW_H, STRIPE)
    page.text(positionText(r), MARGIN, y, 10.5, true, r.position === 1 ? [0.63, 0.47, 0.12] : INK)
    page.text(fit(r.name, 10.5, true, nameMax), nameX, y, 10.5, true, INK)
    if (showThru && r.thru) page.text(r.thru, thruRight, y, 9, false, MUTED, 'right')
    r.rounds.forEach((p, k) => page.text(p === null ? '-' : String(p), roundRights[k], y, 10, false, MUTED, 'right'))
    page.text(String(r.total), ptsRight, y, 11.5, true, INK, 'right')
    y -= ROW_H
  })

  if (board.note && board.rows.length > 0) {
    const lines = wrap(board.note, 9, PAGE_W - MARGIN * 2)
    if (y - 14 * lines.length - 10 < bottom) { page = new Page(); pages.push(page); y = header(page, false) }
    y -= 8
    for (const line of lines) { page.text(line, MARGIN, y, 9, false, MUTED); y -= 12 }
  }

  // Footer on every page.
  pages.forEach((p, i) => {
    p.rect(MARGIN - 6, FOOTER_H - 4, PAGE_W - (MARGIN - 6) * 2, 0.6, [0.85, 0.83, 0.78])
    p.text("Scored live with Teein' It Up", MARGIN, FOOTER_H - 20, 9, true, [0.1, 0.33, 0.2])
    p.text(`Page ${i + 1} of ${pages.length}`, right, FOOTER_H - 20, 9, false, MUTED, 'right')
  })

  // Assemble objects.
  const objs: string[] = []
  const add = (body: string) => { objs.push(body); return objs.length }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // Pages, filled below once kids are known
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  for (const p of pages) {
    const content = p.ops.join('\n')
    const pageNo = objs.length + 1
    const contentNo = pageNo + 1
    kids.push(pageNo)
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(PAGE_W)} ${f2(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`)
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  }
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] >>`
  const infoNo = add(`<< /Title ${pdfLiteral(toWinAnsi(`${board.eventName} leaderboard`.replace(/[^\x20-\x7e]/g, '-')))} /Creator (Teein' It Up) /Producer (Teein' It Up) >>`)

  // The whole file stays pure ASCII, so byte offsets equal string offsets.
  let out = '%PDF-1.4\n%TIU-LEADERBOARD\n'
  const offsets: number[] = []
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i)
    if (c > 126 && c !== 10) throw new Error('PDF builder produced a non-ASCII byte')
    bytes[i] = c
  }
  return bytes
}
