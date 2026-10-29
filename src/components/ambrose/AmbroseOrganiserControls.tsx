'use client'

import { useState } from 'react'
import type { EntryView } from '@/lib/ambrose/teamState'
import { card, h2, body, btnPrimary, btnOutline } from './styles'

// Organiser tools during a round (presentation only): resolve No Returns, release an override lock, change a score with a reason, answer team queries,
// waive a drive requirement. Every action needs a reason; the database records who did it and when.
export interface OrganiserActions {
  overrideScore(entryId: string, holeId: string, gross: number, reason: string, baseRevision: number): Promise<string | null>
  resolveNoReturn(entryId: string, holeId: string, baseRevision: number, reason: string): Promise<string | null>
  releaseLock(entryId: string, holeId: string, reason: string): Promise<string | null>
  resolveFlag(flagId: string, status: 'resolved' | 'dismissed', note: string): Promise<string | null>
  waiveDrive(entryId: string, reason: string): Promise<string | null>
}
interface Props { views: EntryView[]; flags: { id: string; entryId: string; holeId: string }[]; actions: OrganiserActions; names: Record<string, string>; closed: boolean }

export default function AmbroseOrganiserControls({ views, flags, actions, names, closed }: Props) {
  const [entryId, setEntryId] = useState(views[0]?.entryId ?? '')
  const [holeId, setHoleId] = useState('')
  const [gross, setGross] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const v = views.find(x => x.entryId === entryId)
  if (!v) return null
  const hole = v.serverScores.find(s => s.holeId === holeId)
  const num = (id: string) => v.holes.find(h => h.holeId === id)?.number ?? '?'
  const run = async (f: () => Promise<string | null>, ok: string) => {
    if (!reason.trim()) { setMsg('Give a reason first. It is recorded with your name.'); return }
    setBusy(true); const err = await f(); setBusy(false); setMsg(err ?? ok); if (!err) { setReason(''); setGross('') }
  }
  const myFlags = flags.filter(f => f.entryId === entryId)
  return (
    <section aria-label="Organiser tools" style={card}>
      <h2 style={h2}>Organiser tools</h2>
      <p style={body}>Changes are recorded with your name, the time and your reason.{closed ? ' This round is closed: ask for an audited correction instead.' : ''}</p>
      <label htmlFor="org-team" style={{ ...body, display: 'block', marginTop: 10 }}>Team</label>
      <select id="org-team" value={entryId} onChange={e => { setEntryId(e.target.value); setHoleId('') }} style={sel}>{views.map(x => <option key={x.entryId} value={x.entryId}>{x.name}</option>)}</select>

      {v.serverScores.filter(s => s.isNoReturn && s.nrTreatment === null).map(s => (
        <div key={s.holeId} style={row}><span style={{ flex: 1 }}>Hole {num(s.holeId)}: No Return, waiting for you</span>
          <button type="button" style={btnOutline} disabled={busy || closed} onClick={() => run(() => actions.resolveNoReturn(v.entryId, s.holeId, s.revision, reason), `Hole ${num(s.holeId)} recorded as No Score.`)}>Record No Score</button></div>
      ))}
      {v.serverScores.filter(s => s.locked).map(s => (
        <div key={s.holeId} style={row}><span style={{ flex: 1 }}>Hole {num(s.holeId)}: set by organiser ({s.grossScore ?? 'NR'})</span>
          <button type="button" style={btnOutline} disabled={busy || closed} onClick={() => run(() => actions.releaseLock(v.entryId, s.holeId, reason), `Hole ${num(s.holeId)} released to the scorer.`)}>Release to scorer</button></div>
      ))}
      {myFlags.map(f => (
        <div key={f.id} style={row}><span style={{ flex: 1 }}>Query on hole {num(f.holeId)}</span>
          <button type="button" style={btnOutline} disabled={busy} onClick={() => run(() => actions.resolveFlag(f.id, 'resolved', reason), 'Query resolved.')}>Resolve</button>
          <button type="button" style={btnOutline} disabled={busy} onClick={() => run(() => actions.resolveFlag(f.id, 'dismissed', reason), 'Query dismissed.')}>Dismiss</button></div>
      ))}
      {v.completion.driveShortfallPlayers.length > 0 && (
        <div style={row}><span style={{ flex: 1 }}>Minimum drives not met by {v.completion.driveShortfallPlayers.map(id => names[id] ?? 'a player').join(', ')}</span>
          <button type="button" style={btnOutline} disabled={busy} onClick={() => run(() => actions.waiveDrive(v.entryId, reason), 'Drive requirement waived.')}>Waive</button></div>
      )}

      <h3 style={{ ...h2, fontSize: 14, marginTop: 14 }}>Change a score</h3>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <select aria-label="Hole" value={holeId} onChange={e => setHoleId(e.target.value)} style={{ ...sel, flex: 1 }}>
          <option value="">Hole…</option>{v.holes.map(h => <option key={h.holeId} value={h.holeId}>Hole {h.number}</option>)}
        </select>
        <input aria-label="New score" inputMode="numeric" value={gross} onChange={e => setGross(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="Score" style={{ ...sel, width: 90 }} />
      </div>
      <input aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" maxLength={300} style={{ ...sel, marginTop: 8, width: '100%', boxSizing: 'border-box' }} />
      <button type="button" style={{ ...btnPrimary, width: '100%', marginTop: 8 }} disabled={busy || closed || !holeId || gross === ''}
        onClick={() => run(() => actions.overrideScore(v.entryId, holeId, Number(gross), reason, hole?.revision ?? 0), `Hole ${num(holeId)} set to ${gross}. The scorer is locked out of it until you release it.`)}>Set score</button>
      {msg && <p role="status" style={{ ...body, marginTop: 10, color: '#1c1c17' }}>{msg}</p>}
    </section>
  )
}
const sel: React.CSSProperties = { minHeight: 44, borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 10px', fontSize: 15, width: '100%' }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid #f1efe8', fontSize: 14, flexWrap: 'wrap' }
