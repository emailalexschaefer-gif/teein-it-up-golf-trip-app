/**
 * Branded leaderboard PNG, drawn on a canvas in the browser from the same
 * PublicBoard the public page shows (no separate scoring calculation).
 * One tall image holding the ENTIRE field. The canvas is sized so its total
 * area stays under 12 million pixels (comfortably inside the ~16.7M limit of
 * iOS Safari); a field too large for one image (about 150 players) is refused
 * with a clear error so the caller can offer the PDF instead of producing a
 * blank or truncated picture.
 */
import { positionText, medalOf, initialsOf, podiumRows, crownedRows, playerCountText, podiumCaption, statusSubtitle, boardFootnote, hasBoardExtras, type Medal, type PublicBoard } from './publicBoard'
import { CROWN_POINTS, CROWN_BAND, CROWN_GOLD, CROWN_GOLD_DARK } from './crown'

export const PNG_WIDTH = 1080
export const MAX_CANVAS_PIXELS = 12_000_000

const MARGIN = 40
const HEADER_H = 330
const PODIUM_H = 340
const TABLE_HEAD_H = 56
const ROW_H = 72
const NOTE_LINE_H = 34
const FOOTER_H = 260
const GAP = 24

export class PngTooLargeError extends Error {
  constructor(public rows: number) { super(`Too many players (${rows}) for a single image. Use the PDF instead.`) }
}

export interface PngLayout { width: number; height: number; scale: number; noteLines: string[] }

/** Pure layout maths (unit tested). `measure` returns text width in CSS px at the given font. */
export function computePngLayout(board: PublicBoard, wrapNote: (text: string) => string[]): PngLayout {
  const foot = boardFootnote(board)
  const noteLines = foot && (board.rows.length > 0 || hasBoardExtras(board)) ? wrapNote(foot) : []
  const podium = podiumRows(board).length > 0 ? PODIUM_H : 0
  const body = board.rows.length === 0 ? 120 : TABLE_HEAD_H + board.rows.length * ROW_H
  const height = HEADER_H + GAP + podium + body + (noteLines.length ? GAP + noteLines.length * NOTE_LINE_H : 0) + GAP + FOOTER_H
  const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (PNG_WIDTH * height)))
  if (scale < 1) throw new PngTooLargeError(board.rows.length)
  return { width: PNG_WIDTH, height, scale, noteLines }
}

const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxW || !line) line = next
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}

function loadImage(src: string, timeoutMs = 2500): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

export interface PngOptions { generatedText?: string; siteLabel?: string; logoUrl?: string }

const TAGLINE = 'Run your next golf event like a pro.'
const MEDAL_COL: Record<Medal, { from: string; to: string; ring: string }> = {
  gold: { from: '#fff3c4', to: '#f3d77a', ring: '#d4a62a' },
  silver: { from: '#f4f6f7', to: '#d3d8dc', ring: '#9aa3aa' },
  bronze: { from: '#fbe6d2', to: '#e5b184', ring: '#b8733a' },
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 100
  ctx.beginPath()
  CROWN_POINTS.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * k, y + py * k) : ctx.lineTo(x + px * k, y + py * k)))
  ctx.closePath()
  ctx.fillStyle = CROWN_GOLD; ctx.fill(); ctx.lineWidth = Math.max(1.5, size * 0.03); ctx.strokeStyle = CROWN_GOLD_DARK; ctx.lineJoin = 'round'; ctx.stroke()
  roundRect(ctx, x + CROWN_BAND.x * k, y + CROWN_BAND.y * k, CROWN_BAND.w * k, CROWN_BAND.h * k, 3 * k)
  ctx.fillStyle = CROWN_GOLD; ctx.fill(); ctx.stroke()
}

function drawAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, name: string, medal: Medal | null) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = medal ? '#ffffff' : '#e1ece4'; ctx.fill()
  if (medal) { ctx.lineWidth = Math.max(3, r * 0.12); ctx.strokeStyle = MEDAL_COL[medal].ring; ctx.stroke() }
  ctx.fillStyle = '#14532d'; ctx.font = `800 ${Math.round(r * 0.8)}px ${SANS}`; ctx.textAlign = 'center'
  ctx.fillText(initialsOf(name), cx, cy + r * 0.28); ctx.textAlign = 'left'
}

export async function renderBoardPng(board: PublicBoard, opts: PngOptions = {}): Promise<Blob> {
  const generatedText = opts.generatedText ?? new Date(board.generatedAt).toLocaleString()
  const measureCanvas = document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d')
  if (!mctx) throw new Error('Canvas is not available in this browser.')
  mctx.font = `24px ${SANS}`
  const layout = computePngLayout(board, text => wrapText(mctx, text, PNG_WIDTH - MARGIN * 2))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(layout.width * layout.scale)
  canvas.height = Math.round(layout.height * layout.scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.scale(layout.scale, layout.scale)
  ctx.textBaseline = 'alphabetic'

  const logo = opts.logoUrl ? await loadImage(opts.logoUrl) : null
  const W = layout.width
  const live = board.status === 'live'
  const final = board.status === 'final'
  const crowned = new Set(crownedRows(board).map(r => r.name + '|' + r.position))

  // Page background + header band
  ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, W, layout.height)
  const hg = ctx.createLinearGradient(0, 0, 0, HEADER_H); hg.addColorStop(0, '#0b2416'); hg.addColorStop(1, '#14532d')
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, HEADER_H)
  const LOGO = 230
  let textX = MARGIN
  if (logo) { ctx.drawImage(logo, MARGIN - 6, 40, LOGO, LOGO); textX = MARGIN + LOGO + 26 }
  const textMax = W - textX - MARGIN
  ctx.fillStyle = '#e8c96a'; ctx.font = `italic 600 30px ${SERIF}`
  ctx.fillText(ellipsize(ctx, TAGLINE, textMax), textX, 82)
  let size = 62
  ctx.fillStyle = '#faf6ed'
  do { ctx.font = `700 ${size}px ${SERIF}`; size -= 2 } while (ctx.measureText(board.eventName).width > textMax && size > 30)
  ctx.fillText(ellipsize(ctx, board.eventName, textMax), textX, 158)

  // Status pill (LIVE with dot / FINAL RESULTS with crown)
  const pillColors: Record<string, [string, string]> = { live: ['#1b5e35', '#bbf7d0'], round_complete: ['#5b4a17', '#f3dd9a'], final: ['#e8c96a', '#1a1a16'], ended_early: ['#e8c96a', '#1a1a16'], not_started: ['#3d5146', '#e5e7eb'] }
  const [pillBg, pillFg] = pillColors[board.status] ?? pillColors.not_started
  ctx.font = `900 28px ${SANS}`
  const iconW = live ? 30 : final ? 40 : 0
  const pillW = ctx.measureText(board.statusLabel).width + 44 + iconW
  roundRect(ctx, textX, 184, pillW, 54, 27); ctx.fillStyle = pillBg; ctx.fill()
  let px = textX + 22
  if (live) { ctx.beginPath(); ctx.arc(px + 8, 211, 8, 0, Math.PI * 2); ctx.fillStyle = '#4ade80'; ctx.fill(); px += 30 }
  if (final) { drawCrown(ctx, px, 192, 34); px += 40 }
  ctx.fillStyle = pillFg; ctx.fillText(board.statusLabel, px, 222)
  const subText = statusSubtitle(board)
  ctx.fillStyle = '#cfd8d2'; ctx.font = `500 24px ${SANS}`
  ctx.fillText(ellipsize(ctx, subText, textMax), textX, 274)
  ctx.fillStyle = '#9fb3a6'; ctx.font = `400 22px ${SANS}`
  ctx.fillText(ellipsize(ctx, [board.roundLabel, playerCountText(board), generatedText].filter(Boolean).join('  \u00b7  '), textMax), textX, 308)

  let y = HEADER_H + GAP
  const right = W - MARGIN

  // Podium
  const podium = podiumRows(board)
  if (podium.length > 0) {
    ctx.fillStyle = '#6b6b60'; ctx.font = `800 22px ${SANS}`
    ctx.fillText(podiumCaption(board).toUpperCase(), MARGIN, y + 20)
    const gap = 20, cw = (W - MARGIN * 2 - gap * (podium.length - 1)) / podium.length
    podium.forEach((r, i) => {
      const medal = medalOf(r.position) ?? 'bronze', col = MEDAL_COL[medal]
      const cx0 = MARGIN + i * (cw + gap), cy0 = y + 44, ch = 270
      const g = ctx.createLinearGradient(cx0, cy0, cx0 + cw * 0.4, cy0 + ch); g.addColorStop(0, col.from); g.addColorStop(1, col.to)
      roundRect(ctx, cx0, cy0, cw, ch, 24); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col.ring + '88'; ctx.stroke()
      // position chip
      roundRect(ctx, cx0 + 16, cy0 + 16, 50, 40, 20); ctx.fillStyle = col.ring; ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = `800 24px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(positionText(r), cx0 + 41, cy0 + 45); ctx.textAlign = 'left'
      const isCrowned = crowned.has(r.name + '|' + r.position)
      drawAvatar(ctx, cx0 + cw / 2, cy0 + 100, 46, r.name, medal)
      if (isCrowned) drawCrown(ctx, cx0 + cw / 2 - 30, cy0 + 8, 60)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#1a1a16'; ctx.font = `800 27px ${SANS}`
      ctx.fillText(ellipsize(ctx, r.name, cw - 28), cx0 + cw / 2, cy0 + 188)
      ctx.font = `900 44px ${SANS}`
      const numW = ctx.measureText(String(r.total)).width
      ctx.font = `800 22px ${SANS}`
      const labW = ctx.measureText('PTS').width
      const startX = cx0 + cw / 2 - (numW + 8 + labW) / 2
      ctx.textAlign = 'left'
      ctx.font = `900 44px ${SANS}`; ctx.fillText(String(r.total), startX, cy0 + 238)
      ctx.font = `800 22px ${SANS}`; ctx.fillText('PTS', startX + numW + 8, cy0 + 238)
      ctx.textAlign = 'left'
    })
    y += PODIUM_H
  }

  const ptsRight = right - 14
  let cursor = ptsRight - 96
  const roundRights = board.roundColumns.map(() => { const r = cursor; cursor -= 84; return r }).reverse()
  const showThru = live
  const roundsLeft = board.roundColumns.length > 0 ? cursor + 84 - 70 : ptsRight - 96 - 70
  const thruRight = showThru ? roundsLeft - 12 : roundsLeft
  const nameX = MARGIN + 126
  const nameMax = thruRight - (showThru ? 104 : 0) - 20 - nameX - 40

  if (board.rows.length === 0) {
    ctx.fillStyle = '#6b6b60'; ctx.font = `500 28px ${SANS}`; ctx.textAlign = 'center'
    ctx.fillText(board.note ?? 'No scores yet.', W / 2, y + 70); ctx.textAlign = 'left'
    y += 120
  } else {
    roundRect(ctx, MARGIN, y, W - MARGIN * 2, TABLE_HEAD_H + board.rows.length * ROW_H, 20); ctx.save(); ctx.clip()
    ctx.fillStyle = '#ffffff'; ctx.fillRect(MARGIN, y, W - MARGIN * 2, TABLE_HEAD_H + board.rows.length * ROW_H)
    ctx.fillStyle = '#f1ede0'; ctx.fillRect(MARGIN, y, W - MARGIN * 2, TABLE_HEAD_H)
    ctx.fillStyle = '#7a7260'; ctx.font = `800 20px ${SANS}`
    const hy = y + 36
    ctx.fillText('POS', MARGIN + 14, hy); ctx.fillText('PLAYER', nameX, hy)
    ctx.textAlign = 'right'
    if (showThru) ctx.fillText('THRU', thruRight, hy)
    board.roundColumns.forEach((c, i) => ctx.fillText(c.label, roundRights[i], hy))
    ctx.fillText('PTS', ptsRight, hy)
    ctx.textAlign = 'left'
    y += TABLE_HEAD_H
    board.rows.forEach((r, i) => {
      const medal = r.total > 0 ? medalOf(r.position) : null
      ctx.fillStyle = medal === 'gold' ? '#fffbea' : '#ffffff'
      ctx.fillRect(MARGIN, y, W - MARGIN * 2, ROW_H)
      if (i > 0) { ctx.fillStyle = '#f1efe8'; ctx.fillRect(MARGIN, y, W - MARGIN * 2, 2) }
      const by = y + 46
      ctx.fillStyle = medal ? MEDAL_COL[medal].ring : '#4b4b44'; ctx.font = `900 30px ${SANS}`
      ctx.fillText(positionText(r), MARGIN + 14, by)
      drawAvatar(ctx, MARGIN + 94, y + ROW_H / 2, 22, r.name, medal)
      ctx.fillStyle = '#1a1a16'; ctx.font = `700 32px ${SANS}`
      const shown = ellipsize(ctx, r.name, nameMax)
      ctx.fillText(shown, nameX, by)
      if (crowned.has(r.name + '|' + r.position)) drawCrown(ctx, nameX + ctx.measureText(shown).width + 10, y + 18, 34)
      ctx.textAlign = 'right'
      if (showThru && r.thru) { ctx.fillStyle = r.thru === 'F' ? '#166534' : '#7a7260'; ctx.font = `700 24px ${SANS}`; ctx.fillText(r.thru, thruRight, by) }
      ctx.fillStyle = '#6b6b60'; ctx.font = `500 28px ${SANS}`
      r.rounds.forEach((p, k) => ctx.fillText(p === null ? '\u2013' : String(p), roundRights[k], by))
      ctx.fillStyle = '#1a1a16'; ctx.font = `900 36px ${SANS}`; ctx.fillText(String(r.total), ptsRight, by)
      ctx.textAlign = 'left'
      y += ROW_H
    })
    ctx.restore()
  }

  if (layout.noteLines.length) {
    y += GAP
    ctx.fillStyle = '#6b6b60'; ctx.font = `400 24px ${SANS}`
    layout.noteLines.forEach((line, i) => ctx.fillText(line, MARGIN, y + 24 + i * NOTE_LINE_H))
    y += layout.noteLines.length * NOTE_LINE_H
  }

  // Footer invitation
  y = layout.height - FOOTER_H
  const fg = ctx.createLinearGradient(0, y, 0, layout.height); fg.addColorStop(0, '#0b2416'); fg.addColorStop(1, '#14532d')
  ctx.fillStyle = fg; ctx.fillRect(0, y, W, FOOTER_H)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e8c96a'; ctx.font = `800 30px ${SANS}`; ctx.fillText("POWERED BY TEEIN' IT UP", W / 2, y + 66)
  ctx.fillStyle = '#cfd8d2'; ctx.font = `500 24px ${SANS}`; ctx.fillText('SCORE  \u00b7  SHARE  \u00b7  CONNECT', W / 2, y + 108)
  ctx.fillStyle = '#faf6ed'; ctx.font = `italic 600 34px ${SERIF}`; ctx.fillText(TAGLINE, W / 2, y + 168)
  ctx.fillStyle = '#e8c96a'; ctx.font = `800 28px ${SANS}`; ctx.fillText(opts.siteLabel ? `Discover the app  \u2022  ${opts.siteLabel}` : 'Discover the app', W / 2, y + 220)
  ctx.textAlign = 'left'

  return canvasToBlob(canvas)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png')
    } else {
      try {
        const bin = atob(canvas.toDataURL('image/png').split(',')[1])
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        resolve(new Blob([bytes], { type: 'image/png' }))
      } catch { reject(new Error('Could not create the image.')) }
    }
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}
