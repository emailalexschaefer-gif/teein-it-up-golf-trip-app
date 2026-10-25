'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { END_NOTE_MAX, END_REASONS, type EndReason } from '@/lib/trips/eventOutcome'
import type { EndImpact } from '@/lib/scoring/roundLifecycle'

// Organiser-only, EVENT-level control. Ending the event early, cancelling a round and
// declaring an overall champion are three separate decisions: this control owns the
// last two for the event as a whole. All rules live in the end-event route and
// scoring/eventEnd.ts; this is only the confirmation UI. The champion choice defaults to NO.

interface Props { tripId: string; /** True when every remaining round is already cancelled/completed. */ noPlayableRoundsRemain: boolean }

const card: React.CSSProperties = { background: '#ffffff', border: '1px solid #eceae3', borderRadius: 14, padding: 16, marginBottom: 16 }
const btn: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
const label: React.CSSProperties = { display: 'block', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, margin: '12px 0 4px' }

export default function EndEventControl({ tripId, noPlayableRoundsRemain }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [impact, setImpact] = useState<EndImpact | null>(null)
  const [reason, setReason] = useState<EndReason | ''>('')
  const [note, setNote] = useState('')
  const [declareChampion, setDeclareChampion] = useState(false) // default: NO champion
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/trips/${tripId}/end-event`
  const title = noPlayableRoundsRemain ? 'Finish Event' : 'End Event Early'

  async function openDialog() {
    setOpen(true); setError(null); setImpact(null); setReason(''); setNote(''); setDeclareChampion(false); setBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not check the impact.'); return }
      setImpact(body.impact as EndImpact)
    } catch { setError('Could not check the impact. Check your connection.') } finally { setBusy(false) }
  }

  async function confirm() {
    if (!reason) { setError('Please choose a reason.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, note, declareChampion }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not end the event.'); return }
      setOpen(false)
      router.refresh()
    } catch { setError('Could not end the event. Check your connection.') } finally { setBusy(false) }
  }

  return (
    <div style={noPlayableRoundsRemain ? { ...card, borderColor: '#e8c96a' } : { marginBottom: 16 }}>
      {noPlayableRoundsRemain && (
        <>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#14532d', margin: '0 0 4px' }}>No rounds left to play</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#6b6b60', margin: '0 0 12px' }}>
            Finish the event to unlock Final Standings, Event Memories and the Event Presentation. Cancelling a round does not finish the event by itself.
          </p>
        </>
      )}
      <button onClick={openDialog} style={{ ...btn, width: '100%', border: noPlayableRoundsRemain ? 'none' : '1.5px solid #d9d6cb', background: noPlayableRoundsRemain ? '#14532d' : '#fff', color: noPlayableRoundsRemain ? '#fff' : '#1a1a16' }}>
        {title}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', maxHeight: '88dvh', overscrollBehavior: 'contain', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '0 0 8px' }}>{title}?</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#4b4b44', margin: '0 0 12px' }}>
              The event is closed with the rounds that were played. Everything already scored, every Moment and the presentation are kept.
            </p>
            {busy && !impact && !error && <p style={{ fontSize: 13 }}>Checking the impact{'…'}</p>}
            {impact && (
              <div style={{ background: '#faf9f6', border: '1px solid #eceae3', borderRadius: 10, padding: 12, fontFamily: 'var(--font-body)', fontSize: 13.5, marginBottom: 4 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>What changes</p>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  <li>{impact.completedRounds} completed round{impact.completedRounds === 1 ? '' : 's'} keep all scores, side games and Moments.</li>
                  {impact.roundsToCancel > 0 && <li>{impact.roundsToCancel} round{impact.roundsToCancel === 1 ? '' : 's'} not yet played will be cancelled. No results are created for {impact.roundsToCancel === 1 ? 'it' : 'them'}.</li>}
                  <li>Final Standings, Event Memories and the Event Presentation become available.</li>
                </ul>
              </div>
            )}

            <label style={label} htmlFor="end-reason">Reason</label>
            <select id="end-reason" value={reason} onChange={e => setReason(e.target.value as EndReason | '')}
              style={{ width: '100%', minHeight: 44, borderRadius: 10, border: '1px solid #d9d6cb', padding: '0 10px', fontSize: 15, fontFamily: 'var(--font-body)', background: '#fff' }}>
              <option value="">Choose a reason{'…'}</option>
              {END_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label style={label} htmlFor="end-note">Note (optional)</label>
            <textarea id="end-note" value={note} maxLength={END_NOTE_MAX} onChange={e => setNote(e.target.value)} rows={2}
              style={{ width: '100%', borderRadius: 10, border: '1px solid #d9d6cb', padding: 10, fontSize: 15, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }} />

            <fieldset style={{ border: '1px solid #eceae3', borderRadius: 10, padding: '10px 12px', margin: '14px 0 0' }}>
              <legend style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800, padding: '0 6px' }}>Declare an overall event champion?</legend>
              {[{ v: false, t: 'No. Final standings only', d: 'No champion slide, crown or winner language.' }, { v: true, t: 'Yes. Declare the leader the champion', d: 'Decided from the rounds that were played.' }].map(o => (
                <label key={String(o.v)} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, padding: '6px 0', fontFamily: 'var(--font-body)', fontSize: 14, cursor: 'pointer' }}>
                  <input type="radio" name="declare-champion" checked={declareChampion === o.v} onChange={() => setDeclareChampion(o.v)} style={{ marginTop: 4, width: 18, height: 18 }} />
                  <span><strong>{o.t}</strong><br /><span style={{ fontSize: 12.5, color: '#6b6b60' }}>{o.d}</span></span>
                </label>
              ))}
            </fieldset>

            {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, position: 'sticky', bottom: -1, background: '#fff', padding: '10px 0 2px' }}>
              <button onClick={() => setOpen(false)} disabled={busy} style={{ ...btn, flex: 1, border: '1px solid #d9d6cb', background: '#fff', color: '#1a1a16' }}>Keep Event Open</button>
              <button onClick={confirm} disabled={busy || !impact || !reason} style={{ ...btn, flex: 1, border: 'none', background: '#14532d', color: '#fff', opacity: busy || !impact || !reason ? 0.6 : 1 }}>
                {busy && impact ? 'Working…' : title}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
