'use client'

import { useEffect, useState } from 'react'

/**
 * Marker verification — Stage 3. Deliberately NOT a modal: a collapsed
 * summary line sits inline in the scoring shell ("🎯 1 Side Game
 * awaiting verification"), and only expands into the actual CONFIRM/
 * CORRECT/REJECT cards when the marker taps it. Normal hole-by-hole
 * scoring stays the primary, uninterrupted flow — this is additive
 * alongside it, never blocking it.
 *
 * Driven entirely by a GET fetch, not local one-shot state (unlike
 * NewLeaderPrompt) — this is what makes it correctly persist across
 * navigation/reload: there's no "should I show this" flag to lose, the
 * pending list is simply whatever the server currently says is pending
 * for this user, re-fetched on mount and after every action.
 *
 * Uses each claim's own snapshotted verifier — this component never
 * decides who can verify what; it only ever renders whatever the GET
 * returns (which is already filtered server-side to claims where the
 * current user is the required_verifier_id) and lets the verify
 * endpoint's own authority check be the real gate.
 */
interface PendingClaim {
  entryId: string; sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach' | null; compLabel: string
  holeNumber: number | null
  playerId: string; playerName: string
  claimedValue: number | null
  momentUrl: string | null
  // P0 fix — shared-device same-phone verification. True only when
  // this claim's actual required verifier is the caller's paper
  // partner (e.g. Marnie), surfaced to the caller (Alex) because she
  // has no device/session of her own to see it on. Never auto-verified
  // — this only changes the label/framing so it's explicit that the
  // action being taken is "as" the partner, not the caller's own.
  verifyingAsPartner?: boolean
  verifierName?: string | null
}

const COMP_ICON: Record<string, string> = { nearest_pin: '🎯', longest_drive: '💥', pros_approach: '🎯' }

export default function PendingVerificationCard({ tripId, roundId }: { tripId: string; roundId: string }) {
  const [pending, setPending] = useState<PendingClaim[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/trips/${tripId}/side-comps/pending-verifications?roundId=${roundId}`)
      if (res.ok) setPending((await res.json()).pending ?? [])
    } catch { /* ignore — card just shows nothing new until the next successful load */ }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
    // Light polling so a marker sees a new claim appear without needing
    // to navigate away and back — matches the same interval already
    // used elsewhere for round-active live data (e.g. the leaderboard).
    const interval = setInterval(() => void load(), 15000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, roundId])

  if (!loaded || pending.length === 0) return null

  return (
    <div style={{ margin: '0 16px 10px' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#7a5c00' }}>
          🎯 {pending.length} Side Game{pending.length === 1 ? '' : 's'} awaiting verification
        </span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a1791f' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map(claim => (
            <VerificationClaimCard key={claim.entryId} tripId={tripId} claim={claim} onResolved={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function VerificationClaimCard({ tripId, claim, onResolved }: { tripId: string; claim: PendingClaim; onResolved: () => void }) {
  const [correcting, setCorrecting] = useState(false)
  const [correctedValue, setCorrectedValue] = useState('')
  const [submitting, setSubmitting] = useState<'confirm' | 'correct' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'confirm' | 'correct' | 'reject') {
    setSubmitting(decision)
    setError(null)
    try {
      const body: Record<string, unknown> = { decision }
      if (decision === 'correct') body.correctedValue = Number(correctedValue)
      const res = await fetch(`/api/trips/${tripId}/side-comps/${claim.sideCompId}/entries/${claim.entryId}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) { setError(responseBody.error ?? "Couldn't save this decision. Please try again."); return }
      onResolved() // re-fetches the pending list; this card disappears once it's no longer in the result
    } catch {
      setError("Couldn't save this decision. Check your connection and try again.")
    } finally {
      setSubmitting(null)
    }
  }

  const canCorrect = claim.compType === 'nearest_pin' || claim.compType === 'pros_approach'
  const verifierName = claim.verifierName ?? 'Your paper partner'

  return (
    <div style={{ background: '#ffffff', border: '1px solid #eceae3', borderRadius: 12, padding: '12px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        🎯 Side Game to verify
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>{claim.playerName}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginTop: 1 }}>
        {COMP_ICON[claim.compType ?? ''] ?? '🎯'} {claim.compLabel}{claim.holeNumber ? ` — Hole ${claim.holeNumber}` : ''}
      </div>
      {claim.claimedValue != null && (
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15, color: '#7a5c00', marginTop: 2 }}>
          {claim.claimedValue}m
        </div>
      )}

      {/* P0 fix — shared-device same-phone verification. Marnie has no
          device of her own to see this claim on, so it surfaces here,
          on Alex's phone, explicitly labelled as hers to confirm — not
          silently auto-verified, and not presented as if it were Alex's
          own claim to approve. The phone is handed to Marnie for this
          one action. */}
      {claim.verifyingAsPartner && (
        <div style={{ marginTop: 6, background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 8, padding: '6px 10px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#7a5c00' }}>
            ✏️ {verifierName} to verify — hand over the phone
          </span>
        </div>
      )}

      {claim.momentUrl && (
        <a href={claim.momentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f', textDecoration: 'none' }}>
          📸 View Moment
        </a>
      )}

      {!correcting ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            disabled={submitting !== null}
            onClick={() => void decide('confirm')}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#16a34a', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            {submitting === 'confirm' ? '…' : claim.verifyingAsPartner ? `✓ ${verifierName} confirms this result` : '✓ Confirm'}
          </button>
          {canCorrect && (
            <button
              disabled={submitting !== null}
              onClick={() => setCorrecting(true)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#ffffff', color: '#14532d', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
            >
              Correct
            </button>
          )}
          <button
            disabled={submitting !== null}
            onClick={() => void decide('reject')}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#ffffff', color: '#dc2626', border: '1.5px solid #fecaca', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            {submitting === 'reject' ? '…' : 'Reject'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="number" inputMode="decimal" step="0.1" min="0"
              value={correctedValue} onChange={e => setCorrectedValue(e.target.value)}
              placeholder={claim.claimedValue != null ? String(claim.claimedValue) : '0.0'}
              style={{ flex: 1, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13 }}
            />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#6b7280' }}>m</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              onClick={() => { setCorrecting(false); setCorrectedValue('') }}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#ffffff', color: '#374151', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              disabled={submitting !== null || !correctedValue || Number(correctedValue) <= 0}
              onClick={() => void decide('correct')}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: (submitting || !correctedValue) ? 0.6 : 1 }}
            >
              {submitting === 'correct' ? '…' : 'Save correction'}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: '#dc2626', fontSize: 11, marginTop: 6, fontFamily: 'var(--font-body)' }}>{error}</p>}
    </div>
  )
}
