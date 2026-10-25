/**
 * Branded leaderboard PNG, drawn on a canvas in the browser from the same
 * PublicBoard the public page shows (no separate scoring calculation).
 * One tall image holding the ENTIRE field. The canvas is sized so its total
 * area stays under 12 million pixels (comfortably inside the ~16.7M limit of
 * iOS Safari); a field too large for one image (about 150 players) is refused
 * with a clear error so the caller can offer the PDF instead of producing a
 * blank or truncated picture.
 */
import { positionText, type PublicBoard } from './publicBoard'

export const PNG_WIDTH = 1080
export const MAX_CANVAS_PIXELS = 12_000_000

const MARGIN = 40
const HEADER_H = 280
const TABLE_HEAD_H = 56
const ROW_H = 72
const NOTE_LINE_H = 34
const FOOTER_H = 230
const GAP = 24

export class PngTooLargeError extends Error {
  constructor(public rows: number) { super(`Too many players (${rows}) for a single image. Use the PDF instead.`) }
}

export interface PngLayout { width: number; height: number; scale: number; noteLines: string[] }

/** Pure layout maths (unit tested). `measure` returns text width in CSS px at the given font. */
export function computePngLayout(board: PublicBoard, wrapNote: (text: string) => string[]): PngLayout {
  const noteLines = board.note && board.rows.length > 0 ? wrapNote(board.note) : []
  const body = board.rows.length === 0 ? 120 : TABLE_HEAD_H + board.rows.length * ROW_H
  const height = HEADER_H + GAP + body + (noteLines.length ? GAP + noteLines.length * NOTE_LINE_H : 0) + GAP + FOOTER_H
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

  // Background + header band
  ctx.fillStyle = '#faf9f6'; ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.fillStyle = '#0f2d1c'; ctx.fillRect(0, 0, layout.width, HEADER_H)
  let textX = MARGIN
  if (logo) { ctx.drawImage(logo, MARGIN, 34, 150, 150); textX = MARGIN + 176 }
  ctx.fillStyle = '#e8c96a'; ctx.font = `700 26px ${SANS}`; ctx.fillText("TEEIN' IT UP", textX, 66)
  // Event name, shrunk to fit
  let size = 56
  ctx.fillStyle = '#faf6ed'
  do { ctx.font = `700 ${size}px ${SERIF}`; size -= 2 } while (ctx.measureText(board.eventName).width > layout.width - textX - MARGIN && size > 30)
  ctx.fillText(ellipsize(ctx, board.eventName, layout.width - textX - MARGIN), textX, 134)
  // Status pill
  const pillColors: Record<string, [string, string]> = { live: ['#dcfce7', '#166534'], round_complete: ['#fdf3d9', '#8a6a14'], final: ['#e8c96a', '#1a1a16'], not_started: ['#e5e7eb', '#374151'] }
  const [pillBg, pillFg] = pillColors[board.status] ?? pillColors.not_started
  ctx.font = `800 24px ${SANS}`
  const pillW = ctx.measureText(board.statusLabel).width + 40
  ctx.fillStyle = pillBg; roundRect(ctx, textX, 160, pillW, 44, 22); ctx.fill()
  ctx.fillStyle = pillFg; ctx.fillText(board.statusLabel, textX + 20, 191)
  if (board.roundLabel) { ctx.fillStyle = '#cfd8d2'; ctx.font = `500 24px ${SANS}`; ctx.fillText(board.roundLabel, textX + pillW + 20, 191) }
  ctx.fillStyle = '#9fb3a6'; ctx.font = `400 22px ${SANS}`; ctx.fillText(generatedText, textX, 240)

  let y = HEADER_H + GAP
  const right = layout.width - MARGIN
  const ptsRight = right - 14
  let cursor = ptsRight - 96
  const roundRights = board.roundColumns.map(() => { const r = cursor; cursor -= 84; return r }).reverse()
  const showThru = board.status === 'live'
  const roundsLeft = board.roundColumns.length > 0 ? cursor + 84 - 70 : ptsRight - 96 - 70
  const thruRight = showThru ? roundsLeft - 12 : roundsLeft
  const nameX = MARGIN + 100
  const nameMax = thruRight - (showThru ? 104 : 0) - 20 - nameX

  if (board.rows.length === 0) {
    ctx.fillStyle = '#6b6b60'; ctx.font = `500 28px ${SANS}`; ctx.textAlign = 'center'
    ctx.fillText(board.note ?? 'No scores yet.', layout.width / 2, y + 70); ctx.textAlign = 'left'
    y += 120
  } else {
    ctx.fillStyle = '#f6f3ea'; ctx.fillRect(MARGIN, y, layout.width - MARGIN * 2, TABLE_HEAD_H)
    ctx.fillStyle = '#7a7260'; ctx.font = `700 20px ${SANS}`
    const hy = y + 36
    ctx.fillText('POS', MARGIN + 14, hy); ctx.fillText('PLAYER', nameX, hy)
    ctx.textAlign = 'right'
    if (showThru) ctx.fillText('THRU', thruRight, hy)
    board.roundColumns.forEach((c, i) => ctx.fillText(c.label, roundRights[i], hy))
    ctx.fillText('PTS', ptsRight, hy)
    ctx.textAlign = 'left'
    y += TABLE_HEAD_H
    board.rows.forEach((r, i) => {
      ctx.fillStyle = r.position === 1 ? '#fffbeb' : i % 2 ? '#f8f6ef' : '#ffffff'
      ctx.fillRect(MARGIN, y, layout.width - MARGIN * 2, ROW_H)
      const by = y + 46
      ctx.fillStyle = r.position === 1 ? '#a1791f' : '#4b4b44'; ctx.font = `800 30px ${SANS}`
      ctx.fillText(positionText(r), MARGIN + 14, by)
      ctx.fillStyle = '#1a1a16'; ctx.font = `700 32px ${SANS}`
      ctx.fillText(ellipsize(ctx, r.name, nameMax), nameX, by)
      ctx.textAlign = 'right'
      if (showThru && r.thru) { ctx.fillStyle = '#7a7260'; ctx.font = `500 24px ${SANS}`; ctx.fillText(r.thru, thruRight, by) }
      ctx.fillStyle = '#6b6b60'; ctx.font = `500 28px ${SANS}`
      r.rounds.forEach((p, k) => ctx.fillText(p === null ? '–' : String(p), roundRights[k], by))
      ctx.fillStyle = '#1a1a16'; ctx.font = `800 36px ${SANS}`; ctx.fillText(String(r.total), ptsRight, by)
      ctx.textAlign = 'left'
      y += ROW_H
    })
  }

  if (layout.noteLines.length) {
    y += GAP
    ctx.fillStyle = '#6b6b60'; ctx.font = `400 24px ${SANS}`
    layout.noteLines.forEach((line, i) => ctx.fillText(line, MARGIN, y + 24 + i * NOTE_LINE_H))
    y += layout.noteLines.length * NOTE_LINE_H
  }

  // Footer invitation
  y = layout.height - FOOTER_H
  ctx.fillStyle = '#0f2d1c'; ctx.fillRect(0, y, layout.width, FOOTER_H)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#faf6ed'; ctx.font = `700 40px ${SERIF}`; ctx.fillText("Scored live with Teein' It Up", layout.width / 2, y + 80)
  ctx.fillStyle = '#cfd8d2'; ctx.font = `400 26px ${SANS}`; ctx.fillText('The easy way to run golf days and trips with friends.', layout.width / 2, y + 126)
  ctx.fillStyle = '#e8c96a'; ctx.font = `800 28px ${SANS}`; ctx.fillText(opts.siteLabel ? `Discover the app  •  ${opts.siteLabel}` : 'Discover the app', layout.width / 2, y + 180)
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
