'use client'

import { useState } from 'react'
import type { HoleCell, ProgressSummary, SyncSummary } from '@/lib/ambrose/scorerModel'
import { validateGross } from '@/lib/ambrose/scorerModel'
import { card, h2, body, btn, btnPrimary, btnOutline, GREEN } from './styles'

// Team scorer screen (presentation only). The nominated scorer enters ONE gross score per hole for the whole team.
// Writes go through the offline team queue (parent supplies onSubmit); nothing here decides whether a score is accepted.

export interface DriveOption { playerId: string; name: string; used: number; required: number | null }
interface Props {
  teamName: string
  cells: HoleCell[]
  currentHoleId: string | null
  progress: ProgressSummary
  sync: SyncSummary
  drives: DriveOption[] | null
  driveWarning: string | null
  canScore: boolean
  notScorerMessage: string | null
  onSelectHole: (holeId: string) => void
  onSubmit: (v: { holeId: string; gross: number | null; noReturn: boolean; drivePlayerId: string | null; seenRevision: number }) => void
  onResolveConflict: (holeId: string, action: 'accept_server' | 'reapply_mine') => void
  onFlag: (holeId: string) => void
}

const CELL_COLOUR: Record<string, { bg: string; fg: string }> = {
  empty: { bg: '#f4f2ea', fg: '#6b6b60' }, scored: { bg: '#e8f3ec', fg: GREEN }, saving: { bg: '#eef2fb', fg: '#1e3a8a' }, offline_saved: { bg: '#eef2fb', fg: '#1e3a8a' },
  conflict: { bg: '#fdecec', fg: '#b91c1c' }, locked: { bg: '#f3e8ff', fg: '#5b21b6' }, rejected: { bg: '#fdecec', fg: '#b91c1c' },
  no_return: { bg: '#fff7e0', fg: '#7a5600' }, no_return_resolved: { bg: '#fff7e0', fg: '#7a5600' },
}
const cellLabel = (c: HoleCell) => c.state === 'no_return' || c.state === 'no_return_resolved' ? 'NR' : c.gross !== null ? String(c.gross) : '–'

export default function AmbroseTeamScorer(p: Props) {
  const [drive, setDrive] = useState<string>('')
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const cur = p.cells.find(c => c.holeId === p.currentHoleId) ?? null
  const tone = p.sync.banner.tone === 'warn' ? { bg: '#fdecec', fg: '#7f1d1d' } : p.sync.banner.tone === 'info' ? { bg: '#eef2fb', fg: '#1e3a8a' } : { bg: '#e8f3ec', fg: GREEN }

  function submit(gross: number | null, noReturn: boolean) {
    if (!cur) return
    if (!noReturn) { const v = validateGross(gross); if (!v.ok) { setErr(v.message); return } }
    setErr(null); setTyped('')
    p.onSubmit({ holeId: cur.holeId, gross, noReturn, drivePlayerId: drive || null, seenRevision: cur.revision })
  }

  return (
    <section aria-label={`Scorecard for ${p.teamName}`}>
      <div style={card}>
        <h2 style={h2}>{p.teamName}</h2>
        <p style={body}>{p.progress.label} · running gross {p.progress.runningGross}</p>
        <div role="status" style={{ background: tone.bg, color: tone.fg, borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, marginTop: 10 }}>{p.sync.banner.text}</div>
        <div role="group" aria-label="Holes" style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 6, marginTop: 12 }}>
          {p.cells.map(c => {
            const k = CELL_COLOUR[c.state]
            return (
              <button key={c.holeId} type="button" onClick={() => p.onSelectHole(c.holeId)} aria-label={`Hole ${c.number}, par ${c.par}, ${c.state.replace(/_/g, ' ')}`}
                aria-current={c.holeId === p.currentHoleId ? 'true' : undefined}
                style={{ minHeight: 44, borderRadius: 10, border: c.holeId === p.currentHoleId ? `2px solid ${GREEN}` : c.flagged ? '2px solid #b45309' : '1px solid #d9d6c9',
                  background: k.bg, color: k.fg, fontWeight: 800, fontSize: 14, padding: 0, cursor: 'pointer', lineHeight: 1.1 }}>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{c.number}</span>{cellLabel(c)}
              </button>
            )
          })}
        </div>
      </div>

      {p.notScorerMessage && <div style={card}><p role="status" style={body}>{p.notScorerMessage}</p></div>}

      {cur && (
        <div style={card}>
          <h3 style={{ ...h2, fontSize: 16 }}>Hole {cur.number} <span style={{ color: '#6b6b60', fontWeight: 600 }}>· Par {cur.par}</span></h3>
          {cur.note && <p role={cur.needsAction ? 'alert' : 'status'} style={{ ...body, margin: '6px 0 10px', color: cur.needsAction ? '#b91c1c' : '#6b6b60' }}>{cur.note}</p>}

          {cur.state === 'conflict' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button type="button" style={btnPrimary} onClick={() => p.onResolveConflict(cur.holeId, 'accept_server')}>Keep their score</button>
              <button type="button" style={btnOutline} onClick={() => p.onResolveConflict(cur.holeId, 'reapply_mine')}>Use my score ({cur.gross ?? 'NR'})</button>
            </div>
          )}
          {cur.state === 'locked' && cur.needsAction && (
            <div style={{ marginBottom: 12 }}><button type="button" style={btnPrimary} onClick={() => p.onResolveConflict(cur.holeId, 'accept_server')}>Accept the organiser’s score</button></div>
          )}

          {p.canScore && cur.state !== 'conflict' && !(cur.state === 'locked') && (
            <>
              <div role="group" aria-label="Team gross score" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" onClick={() => submit(n, false)} aria-label={`Score ${n}`}
                    style={{ ...btn, minHeight: 52, fontSize: 18, border: cur.gross === n ? `2px solid ${GREEN}` : '1px solid #d9d6c9', background: cur.gross === n ? '#e8f3ec' : '#fff', color: '#1c1c17' }}>{n}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input inputMode="numeric" pattern="[0-9]*" aria-label="Other score" placeholder="13–20" value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 12px', fontSize: 16 }} />
                <button type="button" style={btnOutline} onClick={() => submit(typed === '' ? null : Number(typed), false)}>Save</button>
              </div>
              <button type="button" style={{ ...btn, width: '100%', marginTop: 10, border: '1.5px solid #b45309', background: '#fff', color: '#7a5600' }} onClick={() => submit(null, true)}>
                No Return (team picked up)
              </button>
              <p style={{ ...body, marginTop: 6 }}>No Return records no score. The organiser decides what happens next.</p>
              {err && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}

              {p.drives && (
                <div style={{ marginTop: 14 }}>
                  <label htmlFor="drive" style={{ ...body, display: 'block', marginBottom: 4 }}>Whose drive was used?</label>
                  <select id="drive" value={drive} onChange={e => setDrive(e.target.value)} style={{ minHeight: 44, width: '100%', borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 10px', fontSize: 15 }}>
                    <option value="">Not recorded</option>
                    {p.drives.map(d => <option key={d.playerId} value={d.playerId}>{d.name} — {d.used}{d.required !== null ? ` of ${d.required}` : ''}</option>)}
                  </select>
                  {p.driveWarning && <p role="status" style={{ ...body, color: '#7a5600', marginTop: 6 }}>{p.driveWarning}</p>}
                </div>
              )}
            </>
          )}
          <button type="button" style={{ ...btn, marginTop: 14, border: '1px solid #d9d6c9', background: '#fff', color: '#6b6b60', minHeight: 44 }} onClick={() => p.onFlag(cur.holeId)}>
            {cur.flagged ? 'Query already raised' : 'Query this score'}
          </button>
        </div>
      )}
    </section>
  )
}
