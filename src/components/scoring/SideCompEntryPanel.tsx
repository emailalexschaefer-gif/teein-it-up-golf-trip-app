'use client'

import { useEffect, useState } from 'react'

/**
 * Side Competition CLAIM entry — Stage 2 of Side Game Marker
 * Verification. Shared between SelfMarkerScoreShell and ScoreSessionShell.
 *
 * Strictly renders what the server decides, same principle as before —
 * this component never compares a submitted value against anything
 * itself. What changed since Stage 1: a submission is now explicitly a
 * CLAIM, not a result. It never becomes an "official leader" here —
 * `wouldLeadIfVerified` (would this take the lead if a marker confirms
 * it, right now) is a deliberately different, softer signal than
 * `becameOfficialLeader` (which only exists on the future verification
 * endpoint, not this one). The golfer's own UI reflects this honestly:
 * "awaiting marker verification", never "you're the leader."
 *
 * CLAIM -> CELEBRATE -> CAPTURE -> UPLOAD -> PENDING: this component's
 * only job in that chain is CLAIM. The parent scoring shell owns
 * CELEBRATE/CAPTURE (see NewLeaderPrompt, unchanged in spirit from
 * before — it just now reacts to onWouldLeadIfVerified instead of a
 * confirmed-leader event).
 */
export interface SideCompLeader { playerId: string; playerName: string; resultValue: number | null }
export type SideCompVerificationStatus = 'pending' | 'verified' | 'rejected'
export interface SideCompSubmitResult {
  entryId: string | null
  verificationStatus: SideCompVerificationStatus
  wouldLeadIfVerified: boolean
  requiredVerifierId: string | null
  verifierSource: 'marker' | 'organiser_fallback' | 'self_verified_fallback' | null
  currentLeader: SideCompLeader | null
  // The value THIS player just submitted — sourced from the client's own
  // input, not the server response, since it's simply "what did I just
  // type," unambiguous and not a leadership decision. Needed by the
  // parent (for the Capture the Moment prompt) because currentLeader is
  // explicitly the OFFICIAL/verified leader, which is never this player
  // at claim time — there's no other field carrying their own value.
  claimedValue: number | null
}

interface Props {
  tripId: string
  sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'
  label: string
  icon: string
  currentUserId: string
  // Fires only when a submission's wouldLeadIfVerified is true — the
  // trigger for Capture the Moment. Deliberately never fires on
  // "becameOfficialLeader", because that event doesn't exist on this
  // code path at all anymore — only the future verification action can
  // produce it.
  onWouldLeadIfVerified?: (result: SideCompSubmitResult) => void
}

const QUALIFY_QUESTION: Record<Props['compType'], string> = {
  nearest_pin: 'Did you hit the green?',
  pros_approach: 'Did you hit the green?',
  longest_drive: 'Did you hit the fairway?',
}

const STATUS_LABEL: Record<SideCompVerificationStatus, { text: string; color: string }> = {
  pending:  { text: 'Awaiting marker verification', color: '#a1791f' },
  verified: { text: 'Verified ✓', color: '#16a34a' },
  rejected: { text: 'Not confirmed by your marker', color: '#9ca3af' },
}

export default function SideCompEntryPanel({ tripId, sideCompId, compType, label, icon, currentUserId, onWouldLeadIfVerified }: Props) {
  const [loading, setLoading] = useState(true)
  const [currentLeader, setCurrentLeader] = useState<SideCompLeader | null>(null)
  const [myQualified, setMyQualified] = useState<boolean | null>(null) // null = not yet answered
  const [myResultValue, setMyResultValue] = useState<string>('')
  const [myStatus, setMyStatus] = useState<SideCompVerificationStatus | null>(null)
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<SideCompSubmitResult | null>(null)

  // Load current state once on mount — my own prior claim (if any) and
  // the current OFFICIAL (verified-only) leader, both from the GET,
  // never inferred locally.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Reset every piece of per-user state before fetching — this is
      // the actual fix, not just adding currentUserId to the dependency
      // array. Without this, switching accounts within the same mounted
      // component (this effect now correctly re-fires on that, but a
      // fetch takes a moment) would briefly — or, if the fetch ever
      // fails, indefinitely — show the PREVIOUS user's myStatus/
      // myResultValue/lastResult while the new user's own data is still
      // loading. This is exactly the confirmed root cause of "TEST's
      // freshly-typed 0.5m shown next to Alex's stale Verified ✓" — the
      // old status badge and the newly-typed number were never from the
      // same user's data in the first place.
      setCurrentLeader(null)
      setMyQualified(null)
      setMyResultValue('')
      setMyStatus(null)
      setHasSubmittedOnce(false)
      setLastResult(null)
      setError(null)
      try {
        const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries`)
        if (!res.ok || cancelled) return
        const body = await res.json()
        if (cancelled) return
        setCurrentLeader(body.currentLeader ?? null)
        if (body.myEntry) {
          setHasSubmittedOnce(true)
          setMyQualified(body.myEntry.qualified)
          setMyStatus(body.myEntry.verificationStatus ?? null)
          // Prefill from claimedValue (what the player actually entered),
          // not resultValue (which stays null until a marker verifies) —
          // the form should always show the player their own last claim,
          // regardless of whether it's been reviewed yet.
          if (body.myEntry.claimedValue != null) setMyResultValue(String(body.myEntry.claimedValue))
        }
      } catch { /* ignore — panel just shows the form with no prior state */ }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [tripId, sideCompId, currentUserId])

  async function submit(qualified: boolean, resultValue: number | null, claims: boolean | null) {
    setSubmitting(true)
    setError(null)
    // A Side Competition claim is NOT part of the existing offline queue
    // (Dexie/syncScoreQueue) — deliberately, not an oversight. That
    // queue works because a queued SCORE's outcome is fully known at
    // queue time. A claim's wouldLeadIfVerified is NOT knowable offline
    // — it depends on every other player's currently VERIFIED results at
    // the moment the server processes it. Queuing it would mean either
    // faking that answer client-side or turning Capture the Moment into
    // an async, after-the-fact notification — real architecture, not a
    // quick addition, and still not attempted here.
    //
    // What this DOES guarantee, unchanged from before: a failed/offline
    // claim cannot interfere with normal score entry in any way — this
    // component shares no state, queue, or request with
    // queueScoreEntry/syncScoreQueue.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('No connection right now — your score is safe, but this claim hasn\u2019t saved. Try again once you have signal.')
      setSubmitting(false)
      return
    }
    try {
      const body: Record<string, unknown> = { qualified }
      if (compType === 'longest_drive') {
        if (claims !== null) body.claimsBeatLeader = claims
      } else {
        if (resultValue !== null) body.resultValue = resultValue
      }
      const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) { setError(responseBody.error ?? "Couldn't save your claim. Please try again."); return }
      const result: SideCompSubmitResult = {
        entryId: responseBody.entryId ?? null,
        verificationStatus: responseBody.verificationStatus ?? 'pending',
        wouldLeadIfVerified: !!responseBody.wouldLeadIfVerified,
        requiredVerifierId: responseBody.requiredVerifierId ?? null,
        verifierSource: responseBody.verifierSource ?? null,
        currentLeader: responseBody.currentLeader ?? null,
        claimedValue: resultValue,
      }
      // currentLeader here is the OFFICIAL (verified) leader — unaffected
      // by this submission, since a claim never writes an official
      // result. Shown for context only, so the player understands why
      // they might not be the "leader" on screen yet even if their claim
      // would win.
      setCurrentLeader(result.currentLeader)
      setHasSubmittedOnce(true)
      setMyStatus(result.verificationStatus)
      setLastResult(result)
      if (result.wouldLeadIfVerified) onWouldLeadIfVerified?.(result)
    } catch {
      setError('Couldn\u2019t save your claim — your score is unaffected. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null // avoids a flash of the "no leader yet" state before the real one loads

  const leaderLine = currentLeader
    ? `Current leader: ${currentLeader.playerName}${currentLeader.resultValue != null ? ` · ${currentLeader.resultValue}m` : ''}`
    : 'No verified leader yet — be the first!'

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8c96a' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#7a5c00' }}>
        {leaderLine}
      </div>

      {myStatus && (
        <div style={{ marginTop: 4, fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: STATUS_LABEL[myStatus].color }}>
          {icon} {label}{myResultValue ? ` — ${myResultValue}m` : ''} · {STATUS_LABEL[myStatus].text}
        </div>
      )}

      {lastResult && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 800, color: lastResult.wouldLeadIfVerified ? '#16a34a' : '#6b7280' }}>
          {lastResult.wouldLeadIfVerified
            ? '📸 Claim saved — awaiting your marker\u2019s verification'
            : 'Claim saved — awaiting your marker\u2019s verification'}
        </div>
      )}

      {/* Qualify question — always answerable/re-answerable (this is the
          correction path: same endpoint, just resubmitted). */}
      <div style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#374151' }}>
        {icon} {label} — {QUALIFY_QUESTION[compType]}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          disabled={submitting}
          onClick={() => { setMyQualified(true); if (compType === 'longest_drive') { /* wait for beat-leader answer or submit below */ } }}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            background: myQualified === true ? '#16a34a' : '#ffffff', color: myQualified === true ? '#fff' : '#14532d',
            border: '1.5px solid ' + (myQualified === true ? '#16a34a' : '#d1d5db'),
          }}
        >
          Yes
        </button>
        <button
          disabled={submitting}
          onClick={() => { setMyQualified(false); void submit(false, null, null) }}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            background: myQualified === false ? '#6b7280' : '#ffffff', color: myQualified === false ? '#fff' : '#14532d',
            border: '1.5px solid ' + (myQualified === false ? '#6b7280' : '#d1d5db'),
          }}
        >
          No
        </button>
      </div>

      {myQualified === true && compType !== 'longest_drive' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            type="number" inputMode="decimal" step="0.1" min="0"
            value={myResultValue}
            onChange={e => setMyResultValue(e.target.value)}
            placeholder="0.0"
            style={{ flex: 1, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 14 }}
          />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280' }}>m from pin</span>
          <button
            disabled={submitting || !myResultValue || Number(myResultValue) <= 0}
            onClick={() => void submit(true, Number(myResultValue), null)}
            style={{
              padding: '9px 16px', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: submitting ? 'default' : 'pointer',
              opacity: submitting || !myResultValue ? 0.6 : 1,
            }}
          >
            {submitting ? '…' : hasSubmittedOnce ? 'Update claim' : 'Submit claim'}
          </button>
        </div>
      )}

      {myQualified === true && compType === 'longest_drive' && (
        currentLeader && currentLeader.playerId !== currentUserId ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Did you beat the current leader?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={submitting}
                onClick={() => void submit(true, null, true)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#16a34a', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Yes — I did
              </button>
              <button
                disabled={submitting}
                onClick={() => void submit(true, null, false)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#ffffff', color: '#14532d', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                No
              </button>
            </div>
          </div>
        ) : (
          // No standing OFFICIAL (verified) leader yet, or the current
          // official leader is already this player — a qualifying claim
          // is submitted directly; the server decides wouldLeadIfVerified
          // from there.
          <div style={{ marginTop: 8 }}>
            <button
              disabled={submitting}
              onClick={() => void submit(true, null, null)}
              style={{ width: '100%', padding: '9px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {submitting ? '…' : hasSubmittedOnce ? 'Update claim' : 'Submit claim'}
            </button>
          </div>
        )
      )}

      {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{error}</p>}
    </div>
  )
}
