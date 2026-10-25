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
import { positionText, medalOf, podiumRows, crownedRows, playerCountText, podiumCaption, statusSubtitle, boardFootnote, hasBoardExtras, type Medal, type PublicBoard } from './publicBoard'
import { CROWN_POINTS, CROWN_BAND } from './crown'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const ROW_H = 21
const TABLE_HEAD_H = 22
const FOOTER_H = 44
const BAND_H_FIRST = 124
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
  centered(str: string, cx: number, y: number, size: number, bold: boolean, rgb: [number, number, number]) {
    this.text(str, cx - textWidth(str, size, bold) / 2, y, size, bold, rgb)
  }
  /** Gold crown, vector, same shape as the web page and PNG. (x, y) is the bottom-left of a size x size box. */
  crown(x: number, y: number, size: number) {
    const k = size / 100
    const X = (px: number) => f2(x + px * k), Y = (py: number) => f2(y + (100 - py) * k)
    const pts = CROWN_POINTS.map(([px, py], i) => `${X(px)} ${Y(py)} ${i === 0 ? 'm' : 'l'}`).join(' ')
    this.ops.push(`q ${f2(CROWN_RGB[0])} ${f2(CROWN_RGB[1])} ${f2(CROWN_RGB[2])} rg ${f2(CROWN_EDGE[0])} ${f2(CROWN_EDGE[1])} ${f2(CROWN_EDGE[2])} RG 0.6 w 1 j ${pts} h B ${X(CROWN_BAND.x)} ${Y(CROWN_BAND.y + CROWN_BAND.h)} ${f2(CROWN_BAND.w * k)} ${f2(CROWN_BAND.h * k)} re B Q`)
  }
  image(name: string, x: number, y: number, w: number, h: number) {
    this.ops.push(`q ${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(y)} cm /${name} Do Q`)
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
const CROWN_RGB: [number, number, number] = [0.878, 0.706, 0.227]
const CROWN_EDGE: [number, number, number] = [0.631, 0.475, 0.122]
const MEDAL_PDF: Record<Medal, { fill: [number, number, number]; ring: [number, number, number] }> = {
  gold: { fill: [0.99, 0.93, 0.72], ring: [0.83, 0.65, 0.16] },
  silver: { fill: [0.91, 0.92, 0.93], ring: [0.6, 0.64, 0.67] },
  bronze: { fill: [0.96, 0.87, 0.78], ring: [0.72, 0.45, 0.23] },
}
const TAGLINE = 'Run your next golf event like a pro.'
const PODIUM_H = 92

/** Optional logo, decoded in the browser from the app's own brand asset: 8-bit RGB and 8-bit alpha, row by row. */
export interface PdfLogo { width: number; height: number; rgb: Uint8Array; alpha: Uint8Array }

export interface PdfOptions { generatedText?: string; logo?: PdfLogo | null }

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

  const live = board.status === 'live'
  const final = board.status === 'final'
  const finished = final || board.status === 'ended_early'
  const crowned = new Set(crownedRows(board).map(r => r.name + '|' + r.position))
  const logo = opts.logo && opts.logo.width > 0 && opts.logo.rgb.length === opts.logo.width * opts.logo.height * 3 && opts.logo.alpha.length === opts.logo.width * opts.logo.height ? opts.logo : null

  function header(page: Page, first: boolean): number {
    const band = first ? BAND_H_FIRST : BAND_H_NEXT
    page.rect(0, PAGE_H - band, PAGE_W, band, GREEN)
    if (first) {
      const LOGO = 100
      let tx = MARGIN
      if (logo) { page.image('Im1', MARGIN - 4, PAGE_H - band + 12, LOGO, LOGO); tx = MARGIN + LOGO + 12 }
      const tmax = PAGE_W - MARGIN - tx
      page.text(fit(TAGLINE, 9.5, false, tmax), tx, PAGE_H - 28, 9.5, false, GOLD)
      page.text(fit(board.eventName, 22, true, tmax), tx, PAGE_H - 55, 22, true, WHITE)
      // status pill: LIVE / FINAL RESULTS / ...
      const label = board.statusLabel
      const icon = final ? 14 : live ? 10 : 0
      const pw = textWidth(label, 10, true) + 18 + icon
      page.rect(tx, PAGE_H - 86, pw, 20, finished ? GOLD : live ? [0.11, 0.37, 0.21] : [0.24, 0.32, 0.28])
      let px = tx + 9
      if (live) { page.rect(px, PAGE_H - 79, 6, 6, [0.29, 0.87, 0.5]); px += 10 }
      if (final) { page.crown(px, PAGE_H - 83, 12); px += 14 }
      page.text(label, px, PAGE_H - 79.5, 10, true, finished ? INK : live ? [0.73, 0.97, 0.82] : [0.9, 0.9, 0.9])
      const sub = statusSubtitle(board)
      page.text(fit(sub, 9, false, tmax - pw - 10), tx + pw + 10, PAGE_H - 79.5, 9, false, [0.81, 0.85, 0.82])
      page.text(fit([board.roundLabel, playerCountText(board)].filter(Boolean).join('  -  '), 9, false, tmax), tx, PAGE_H - 106, 9, false, [0.62, 0.7, 0.65])
    } else {
      page.text(fit(board.eventName, 14, true, PAGE_W - MARGIN * 2), MARGIN, PAGE_H - 27, 14, true, WHITE)
    }
    let y = PAGE_H - band - 20
    if (first) { page.text(generatedText, MARGIN, y, 9, false, MUTED); y -= 20 }
    if (first) {
      const pod = podiumRows(board)
      if (pod.length > 0) {
        page.text(podiumCaption(board).toUpperCase(), MARGIN, y - 4, 8.5, true, MUTED)
        const gap = 10, cw = (PAGE_W - MARGIN * 2 - gap * (pod.length - 1)) / pod.length
        const top = y - 14
        pod.forEach((r, i) => {
          const medal = medalOf(r.position) ?? 'bronze', col = MEDAL_PDF[medal]
          const x0 = MARGIN + i * (cw + gap), y0 = top - (PODIUM_H - 18)
          page.rect(x0, y0, cw, PODIUM_H - 18, col.ring)
          page.rect(x0 + 1, y0 + 1, cw - 2, PODIUM_H - 20, col.fill)
          page.text(positionText(r), x0 + 8, top - 16, 11, true, col.ring)
          if (crowned.has(r.name + '|' + r.position)) page.crown(x0 + cw / 2 - 10, top - 28, 20)
          page.centered(fit(r.name, 11, true, cw - 16), x0 + cw / 2, top - 44, 11, true, INK)
          page.centered(`${r.total} PTS`, x0 + cw / 2, top - 64, 16, true, INK)
        })
        y -= PODIUM_H + 22
      } else y -= 6
    }
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
    const isCrowned = crowned.has(r.name + '|' + r.position)
    const shownName = fit(r.name, 10.5, true, nameMax - (isCrowned ? 16 : 0))
    page.text(shownName, nameX, y, 10.5, true, INK)
    if (isCrowned) page.crown(nameX + textWidth(shownName, 10.5, true) + 5, y - 2, 11)
    if (showThru && r.thru) page.text(r.thru, thruRight, y, 9, false, MUTED, 'right')
    r.rounds.forEach((p, k) => page.text(p === null ? '-' : String(p), roundRights[k], y, 10, false, MUTED, 'right'))
    page.text(String(r.total), ptsRight, y, 11.5, true, INK, 'right')
    y -= ROW_H
  })

  const footnote = boardFootnote(board)
  if (footnote && (board.rows.length > 0 || hasBoardExtras(board))) {
    const lines = wrap(footnote, 9, PAGE_W - MARGIN * 2)
    if (y - 14 * lines.length - 10 < bottom) { page = new Page(); pages.push(page); y = header(page, false) }
    y -= 8
    for (const line of lines) { page.text(line, MARGIN, y, 9, false, MUTED); y -= 12 }
  }

  // Footer on every page.
  pages.forEach((p, i) => {
    p.rect(MARGIN - 6, FOOTER_H - 4, PAGE_W - (MARGIN - 6) * 2, 0.6, [0.85, 0.83, 0.78])
    p.text("Powered by Teein' It Up", MARGIN, FOOTER_H - 20, 9, true, [0.1, 0.33, 0.2])
    p.text(TAGLINE, MARGIN + textWidth("Powered by Teein' It Up", 9, true) + 10, FOOTER_H - 20, 8.5, false, MUTED)
    p.text(`Page ${i + 1} of ${pages.length}`, right, FOOTER_H - 20, 9, false, MUTED, 'right')
  })

  // Assemble objects.
  const objs: string[] = []
  const add = (body: string) => { objs.push(body); return objs.length }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // Pages, filled below once kids are known
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  let xobject = ''
  if (logo) {
    const hex = (a: Uint8Array) => { let h = ''; for (let i = 0; i < a.length; i++) h += (a[i] < 16 ? '0' : '') + a[i].toString(16); return h + '>' }
    const maskNo = add(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${logo.alpha.length * 2 + 1} >>\nstream\n${hex(logo.alpha)}\nendstream`)
    const imgNo = add(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${maskNo} 0 R /Filter /ASCIIHexDecode /Length ${logo.rgb.length * 2 + 1} >>\nstream\n${hex(logo.rgb)}\nendstream`)
    xobject = ` /XObject << /Im1 ${imgNo} 0 R >>`
  }
  const kids: number[] = []
  for (const p of pages) {
    const content = p.ops.join('\n')
    const pageNo = objs.length + 1
    const contentNo = pageNo + 1
    kids.push(pageNo)
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(PAGE_W)} ${f2(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobject} >> /Contents ${contentNo} 0 R >>`)
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
