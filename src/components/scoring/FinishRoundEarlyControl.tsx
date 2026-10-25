'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EARLY_NOTE_MAX, EARLY_REASONS, type EarlyReason, type EarlyFinishPreview } from '@/lib/scoring/earlyFinish'

// Organiser-only. THREE separate actions exist and this is only the middle one:
//   Cancel Round       - an upcoming round that will not be played (CancelRoundControl)
//   Finish Round Early - a round already in play that cannot be completed (this control)
//   Close Round        - normal completion (TournamentControl)
// Finishing early never cancels the round, never ends the event and never declares a champion.
// Every rule lives in /finish-early, scoring/earlyFinish.ts and migration 100; this is only the confirmation UI.

interface Props { tripId: string; roundId: string; roundName: string }

const btn: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
const label: React.CSSProperties = { display: 'block', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, margin: '12px 0 4px' }
const radioRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, padding: '6px 0', fontFamily: 'var(--font-body)', fontSize: 14, cursor: 'pointer' }

export default function FinishRoundEarlyControl({ tripId, roundId, roundName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<EarlyFinishPreview | null>(null)
  const [reason, setReason] = useState<EarlyReason | ''>('')
  const [note, setNote] = useState('')
  const [officialResult, setOfficialResult] = useState<'nine_hole' | 'none'>('nine_hole')
  const [counts, setCounts] = useState(false) // default: NOT counted toward the championship
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/trips/${tripId}/rounds/${roundId}/finish-early`

  async function openDialog() {
    setOpen(true); setError(null); setPreview(null); setReason(''); setNote(''); setCounts(false); setAck(false); setBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not check the impact.'); return }
      const p = body.preview as EarlyFinishPreview
      setPreview(p); setOfficialResult(p.qualifying > 0 ? 'nine_hole' : 'none')
    } catch { setError('Could not check the impact. Check your connection.') } finally { setBusy(false) }
  }

  const canCount = officialResult === 'nine_hole' && (preview?.qualifying ?? 0) > 0
  const needsAck = counts && canCount && !!preview?.mixedNines
  const ready = !!preview && !!reason && !busy && (!needsAck || ack)

  async function confirm() {
    if (!reason) { setError('Please choose a reason.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note, officialResult, countsTowardEvent: counts && canCount, acknowledgeMixedNines: needsAck && ack }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not finish the round early.'); return }
      setOpen(false); router.refresh()
    } catch { setError('Could not finish the round early. Check your connection.') } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={openDialog} style={{ ...btn, width: '100%', border: '1.5px solid #d9b45a', background: '#fffaf0', color: '#7a5a00' }}>
        Finish Round Early
      </button>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', margin: '6px 0 0' }}>
        For a round that cannot be completed (for example weather). Real scores are kept; nothing is turned into zeros.
      </p>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Finish round early" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: '20px 20px 0', maxHeight: '88dvh', overscrollBehavior: 'contain', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '0 0 8px' }}>Finish {roundName} early?</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#4b4b44', margin: '0 0 12px' }}>
              The round is closed with the holes that were played. This does not end the event and does not declare a champion.
            </p>
            {busy && !preview && !error && <p style={{ fontSize: 13 }}>Checking the impact{'…'}</p>}
            {preview && (
              <div style={{ background: '#faf9f6', border: '1px solid #eceae3', borderRadius: 10, padding: 12, fontFamily: 'var(--font-body)', fontSize: 13.5, marginBottom: 4 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>What this means</p>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  <li>{preview.qualifying} player{preview.qualifying === 1 ? ' has' : 's have'} a valid nine-hole result (their first nine holes in playing order, all scored).</li>
                  <li>{preview.incomplete} player{preview.incomplete === 1 ? ' has' : 's have'} fewer than nine eligible holes. They stay <strong>incomplete</strong>: every score and point is kept, they just get no qualifying result.</li>
                  <li>All scores, side games, Makers &amp; Breakers and Moments are preserved. Holes not played are simply not played.</li>
                  {preview.upcomingRoundsUntouched > 0 && <li>{preview.upcomingRoundsUntouched} upcoming round{preview.upcomingRoundsUntouched === 1 ? ' is' : 's are'} not affected.</li>}
                </ul>
                {preview.players.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>Player by player</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none', lineHeight: 1.6 }}>
                      {preview.players.map(pl => (
                        <li key={pl.playerId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{pl.name}</span>
                          <span style={{ color: pl.kind === 'qualifying' ? '#14532d' : '#7a5a00' }}>
                            {pl.kind === 'qualifying' ? `${pl.officialPoints} pts (9 holes)` : `Incomplete · ${pl.holesPlayed} holes · ${pl.actualPoints} pts`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <label style={label} htmlFor="early-reason">Reason</label>
            <select id="early-reason" value={reason} onChange={e => setReason(e.target.value as EarlyReason | '')}
              style={{ width: '100%', minHeight: 44, borderRadius: 10, border: '1px solid #d9d6cb', padding: '0 10px', fontSize: 15, fontFamily: 'var(--font-body)', background: '#fff' }}>
              <option value="">Choose a reason{'…'}</option>
              {EARLY_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label style={label} htmlFor="early-note">Note (optional)</label>
            <textarea id="early-note" value={note} maxLength={EARLY_NOTE_MAX} onChange={e => setNote(e.target.value)} rows={2}
              style={{ width: '100%', borderRadius: 10, border: '1px solid #d9d6cb', padding: 10, fontSize: 15, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }} />

            <fieldset style={{ border: '1px solid #eceae3', borderRadius: 10, padding: '10px 12px', margin: '14px 0 0' }}>
              <legend style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800, padding: '0 6px' }}>Official result for this round</legend>
              <label style={radioRow}>
                <input type="radio" name="early-official" checked={officialResult === 'nine_hole'} disabled={!preview || preview.qualifying === 0} onChange={() => setOfficialResult('nine_hole')} style={{ marginTop: 4, width: 18, height: 18 }} />
                <span><strong>Shortened nine-hole result</strong><br /><span style={{ fontSize: 12.5, color: '#6b6b60' }}>Players with a valid nine get an Official 9-Hole Result. Others are incomplete.</span></span>
              </label>
              <label style={radioRow}>
                <input type="radio" name="early-official" checked={officialResult === 'none'} onChange={() => { setOfficialResult('none'); setCounts(false); setAck(false) }} style={{ marginTop: 4, width: 18, height: 18 }} />
                <span><strong>No official result</strong><br /><span style={{ fontSize: 12.5, color: '#6b6b60' }}>Round recorded as finished early. All scores kept, nobody ranked.</span></span>
              </label>
            </fieldset>

            <fieldset style={{ border: '1px solid #eceae3', borderRadius: 10, padding: '10px 12px', margin: '12px 0 0' }}>
              <legend style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800, padding: '0 6px' }}>Count this shortened round toward the event championship?</legend>
              <label style={radioRow}>
                <input type="radio" name="early-counts" checked={!counts} onChange={() => { setCounts(false); setAck(false) }} style={{ marginTop: 4, width: 18, height: 18 }} />
                <span><strong>No (recommended)</strong><br /><span style={{ fontSize: 12.5, color: '#6b6b60' }}>Shown as &ldquo;Not Counted Toward Event Championship&rdquo;. Still appears in Event Memories and the presentation.</span></span>
              </label>
              <label style={{ ...radioRow, opacity: canCount ? 1 : 0.5 }}>
                <input type="radio" name="early-counts" checked={counts} disabled={!canCount} onChange={() => setCounts(true)} style={{ marginTop: 4, width: 18, height: 18 }} />
                <span><strong>Yes, count the official nine-hole results</strong><br /><span style={{ fontSize: 12.5, color: '#6b6b60' }}>Players who are incomplete are listed as &ldquo;Not ranked &mdash; incomplete round&rdquo; instead of being ranked or given zero.</span></span>
              </label>
            </fieldset>

            {needsAck && (
              <div role="alert" style={{ background: '#fff7e6', border: '1px solid #e8c96a', borderRadius: 10, padding: 12, margin: '12px 0 0', fontFamily: 'var(--font-body)', fontSize: 13.5 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Groups played different nines</p>
                <p style={{ margin: '0 0 8px' }}>Different starting holes can mean different stroke allocations and playing conditions. No adjustment is made. Each player&rsquo;s own first nine holes are used.</p>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
                  <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
                  <span>I understand, and I still want to count this round toward the championship.</span>
                </label>
              </div>
            )}

            {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, position: 'sticky', bottom: 0, background: '#fff', padding: '10px 0 calc(16px + env(safe-area-inset-bottom))' }}>
              <button onClick={() => setOpen(false)} disabled={busy} style={{ ...btn, flex: 1, border: '1px solid #d9d6cb', background: '#fff', color: '#1a1a16' }}>Keep Round Active</button>
              <button onClick={confirm} disabled={!ready} style={{ ...btn, flex: 1, border: 'none', background: '#14532d', color: '#fff', opacity: ready ? 1 : 0.6 }}>
                {busy && preview ? 'Working…' : 'Finish Round Early'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
