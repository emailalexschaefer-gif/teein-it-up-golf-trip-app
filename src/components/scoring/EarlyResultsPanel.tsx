'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// Shown for a COMPLETED round that was finished early. Official results are frozen; this panel only offers the two
// explicit, audited organiser actions: change whether the round counts toward the championship, and
// "Refresh Official Results" when scores were corrected after the round was finished. Nothing recalculates silently.

interface Props { tripId: string; roundId: string; eventEnded: boolean }
interface Named { playerId: string; name: string }
interface Status {
  finishedEarly: boolean; reason?: string | null; note?: string | null
  labels?: { title: string; result: string; counting: string } | null
  officialHoles?: number | null; countsTowardEvent?: boolean
  stale?: boolean; changed?: Named[]; added?: Named[]; removed?: Named[]
}

const btn: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }

export default function EarlyResultsPanel({ tripId, roundId, eventEnded }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [needsAck, setNeedsAck] = useState(false)
  const [ack, setAck] = useState(false)
  const url = `/api/trips/${tripId}/rounds/${roundId}/early-results`

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) setStatus(await res.json())
    } catch { /* leave as is */ }
  }, [url])
  useEffect(() => { void load() }, [load])

  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.code === 'MIXED_NINES_ACK_REQUIRED') setNeedsAck(true)
        setError(body.error ?? 'Could not update the results.'); return
      }
      setNeedsAck(false); setAck(false)
      setNotice(eventEnded ? `${done} Republish the Event Presentation so it matches.` : done)
      await load(); router.refresh()
    } catch { setError('Could not update the results. Check your connection.') } finally { setBusy(false) }
  }

  if (!status || !status.finishedEarly) return null
  const l = status.labels
  const names = (xs?: Named[]) => (xs ?? []).map(x => x.name).join(', ')
  const changedAny = (status.changed?.length ?? 0) + (status.added?.length ?? 0) + (status.removed?.length ?? 0) > 0

  return (
    <div style={{ background: '#fffaf0', border: '1px solid #e8c96a', borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#7a5a00', margin: '0 0 4px' }}>{l?.title ?? 'Round Finished Early'}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#4b4b44', margin: '0 0 4px' }}>{l?.result} &middot; {l?.counting}</p>
      {status.note && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#6b6b60', margin: '0 0 8px' }}>Note: {status.note}</p>}

      {status.stale && changedAny && (
        <div role="status" style={{ background: '#fff', border: '1px solid #e5c1c1', borderRadius: 10, padding: 10, margin: '8px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}>
          <strong>Official results may be out of date.</strong> A score changed after this round was finished.
          {status.changed && status.changed.length > 0 && <div>Changed: {names(status.changed)}</div>}
          {status.added && status.added.length > 0 && <div>New: {names(status.added)}</div>}
          {status.removed && status.removed.length > 0 && <div>No longer in the round: {names(status.removed)}</div>}
          <button onClick={() => post({ action: 'refresh' }, 'Official results refreshed.')} disabled={busy} style={{ ...btn, marginTop: 8, border: '1.5px solid #14532d', background: '#fff', color: '#14532d' }}>
            {busy ? 'Working…' : 'Refresh Official Results'}
          </button>
        </div>
      )}

      {status.officialHoles ? (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => post({ action: 'set_inclusion', countsTowardEvent: !status.countsTowardEvent, acknowledgeMixedNines: ack }, status.countsTowardEvent ? 'Round no longer counts toward the championship.' : 'Round now counts toward the championship.')}
            disabled={busy || (needsAck && !ack)} style={{ ...btn, border: '1px solid #d9d6cb', background: '#fff', color: '#1a1a16' }}>
            {status.countsTowardEvent ? 'Stop counting toward championship' : 'Count toward championship'}
          </button>
          {needsAck && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
              <span>Groups played different nines (different stroke allocations and conditions). I understand and still want this round to count.</span>
            </label>
          )}
        </div>
      ) : null}
      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#14532d', fontSize: 13, margin: '10px 0 0' }}>{notice}</p>}
    </div>
  )
}
