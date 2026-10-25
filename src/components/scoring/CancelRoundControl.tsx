'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CANCEL_REASON_MAX, type CancelImpact } from '@/lib/scoring/roundLifecycle'

// Organiser-only control for an UNPLAYED round: "Cancel Round" (with an impact
// preview and optional reason) when the round is upcoming, and a cancelled
// panel with "Reinstate Round" when it has been cancelled. All rules live in
// the cancel/reinstate API routes and roundLifecycle.ts -- this is only UI.

interface Props { tripId: string; roundId: string; roundName: string; status: string; onCancelled?: () => void }

const card: React.CSSProperties = { background: '#ffffff', border: '1px solid #eceae3', borderRadius: 14, padding: 16, marginBottom: 16 }
const btn: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }

export default function CancelRoundControl({ tripId, roundId, roundName, status, onCancelled }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [impact, setImpact] = useState<CancelImpact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/trips/${tripId}/rounds/${roundId}`

  async function openDialog() {
    setOpen(true); setError(null); setImpact(null); setBusy(true)
    try {
      const res = await fetch(`${base}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not check the impact.'); return }
      setImpact(body.impact as CancelImpact)
    } catch { setError('Could not check the impact. Check your connection.') } finally { setBusy(false) }
  }

  async function confirmCancel() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not cancel the round.'); return }
      setOpen(false)
      setNotice(body.eventCompleted ? 'Round cancelled. The event is now complete.' : 'Round cancelled.')
      onCancelled?.()
      router.refresh()
    } catch { setError('Could not cancel the round. Check your connection.') } finally { setBusy(false) }
  }

  async function reinstate() {
    if (!window.confirm(`Reinstate ${roundName}? It will return to Upcoming.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/reinstate`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not reinstate the round.'); return }
      setNotice(body.presentationPublished
        ? 'Round reinstated. A presentation is already published — republish it when the event is complete again.'
        : 'Round reinstated.')
      router.refresh()
    } catch { setError('Could not reinstate the round. Check your connection.') } finally { setBusy(false) }
  }

  if (status === 'cancelled') {
    return (
      <div style={card}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#7a1f1f', margin: '0 0 4px' }}>{roundName} was cancelled</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#6b6b60', margin: '0 0 12px' }}>
          This round is not counted in standings, results or the presentation. No scores were recorded for it.
        </p>
        <button onClick={reinstate} disabled={busy} style={{ ...btn, border: '1.5px solid #14532d', background: '#fff', color: '#14532d' }}>
          {busy ? 'Working…' : 'Reinstate Round'}
        </button>
        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
        {notice && <p role="status" style={{ color: '#14532d', fontSize: 13, margin: '10px 0 0' }}>{notice}</p>}
      </div>
    )
  }

  if (status !== 'upcoming') return null

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={openDialog} style={{ ...btn, width: '100%', border: '1.5px solid #e5c1c1', background: '#fff', color: '#9b1c1c' }}>
        Cancel Round
      </button>
      {notice && <p role="status" style={{ color: '#14532d', fontSize: 13, margin: '10px 0 0' }}>{notice}</p>}
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Cancel round" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '0 0 8px' }}>Cancel {roundName}?</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#4b4b44', margin: '0 0 12px' }}>
              Use this when the round will not be played (for example weather or course closure). The round is kept on record with no scores, and you can reinstate it later.
            </p>
            {busy && !impact && !error && <p style={{ fontSize: 13 }}>Checking the impact{'…'}</p>}
            {impact && (
              <div style={{ background: '#faf9f6', border: '1px solid #eceae3', borderRadius: 10, padding: 12, fontFamily: 'var(--font-body)', fontSize: 13.5, marginBottom: 12 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>What changes</p>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  <li>{impact.completedRounds} completed round{impact.completedRounds === 1 ? '' : 's'} keep all results, side games and highlights.</li>
                  <li>The cancelled round is excluded from standings, statistics and the presentation.</li>
                  {impact.completesEvent
                    ? <li><strong>The event will be marked complete</strong>, and the champion is decided from the completed round{impact.completedRounds === 1 ? '' : 's'}.</li>
                    : impact.noCompletedRounds
                      ? <li>No round has been completed yet, so the event stays open.</li>
                      : <li>The event stays open until the remaining rounds are played or cancelled.</li>}
                </ul>
              </div>
            )}
            <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, marginBottom: 4 }} htmlFor="cancel-reason">Reason (optional)</label>
            <textarea id="cancel-reason" value={reason} maxLength={CANCEL_REASON_MAX} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="e.g. Heavy rain, course closed" style={{ width: '100%', borderRadius: 10, border: '1px solid #d9d6cb', padding: 10, fontSize: 15, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }} />
            {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => setOpen(false)} disabled={busy} style={{ ...btn, flex: 1, border: '1px solid #d9d6cb', background: '#fff', color: '#1a1a16' }}>Keep Round</button>
              <button onClick={confirmCancel} disabled={busy || !impact} style={{ ...btn, flex: 1, border: 'none', background: '#9b1c1c', color: '#fff', opacity: busy || !impact ? 0.6 : 1 }}>
                {busy && impact ? 'Cancelling…' : 'Cancel Round'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
