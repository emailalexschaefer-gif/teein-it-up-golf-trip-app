'use client'

import { useEffect, useState } from 'react'
import MomentCapture from '@/components/moments/MomentCapture'
import { trackEvent } from '@/lib/analytics/trackEvent'
import { resolveCompetitorDisplayName, resolveSideCompMomentEntryId } from '@/lib/scoring/sideCompIdentity'

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
  // 1 Sep field-test bundle — "Darren Lappen · pending verification"
  // shown when the actual competitor was Razzle Dazzle, root cause.
  // This result previously carried no identity for WHO the claim was
  // actually for at all — the caller (SelfMarkerScoreShell's
  // onWouldLeadIfVerified) had no correct value available and used the
  // authenticated device operator's own name instead, which is only
  // ever right when someone submits for themselves. The persisted
  // claim itself was always correctly keyed by the real competitor
  // (side_comp_entries.player_id / selectedPlayerId here) — this was
  // purely a missing-field display bug in one celebratory prompt, not
  // an identity bug in any stored data, confirmed by tracing every
  // other consumer of this submission (the entries GET, the
  // leaderboard, pending-verifications) already correctly using
  // player_id/playerName throughout.
  competitorPlayerId: string
  competitorPlayerName: string
}

interface Props {
  tripId: string
  sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'
  label: string
  icon: string
  currentUserId: string
  // Photo capture wiring — needed to render MomentCapture directly in
  // this panel (item 4: "associate the photo with the correct round_id
  // and Side Game context"). Both optional so a call site that
  // genuinely has no round/group context (none exists currently, but
  // this keeps the prop non-breaking) degrades to no photo option
  // rather than a crash.
  roundId?: string | null
  myGroupId?: string | null
  holeNumber?: number | null
  // Side Games proxy entry — the digital scorer's own playing group,
  // used to populate "Result for." Deliberately scoped to the playing
  // group only, not the whole event roster, matching the explicit
  // "playing-group assistance, not unrestricted result administration"
  // instruction. Optional and defaults to empty so every existing call
  // site that doesn't pass it renders identically to before this
  // feature — the selector only appears when there's genuinely more
  // than one eligible player to choose from.
  groupMembers?: { id: string; name: string }[]
  // Fires only when a submission's wouldLeadIfVerified is true — the
  // trigger for Capture the Moment. Deliberately never fires on
  // "becameOfficialLeader", because that event doesn't exist on this
  // code path at all anymore — only the future verification action can
  // produce it.
  onWouldLeadIfVerified?: (result: SideCompSubmitResult) => void
  // P0 follow-up — shared-device same-phone verification. Only passed
  // by the scoring shell when genuinely in shared-device mode.
  // sharedDevicePartnerId is the paper partner's real player id (e.g.
  // Marnie), used purely for comparison against this claim's own
  // required_verifier_id (from the GET) — never trusted as an identity
  // to act as; the verify endpoint independently re-derives and
  // validates the actual pairing server-side before allowing anything.
  sharedDevicePartnerId?: string | null
  sharedDevicePartnerName?: string | null
}

const QUALIFY_QUESTION: Record<Props['compType'], string> = {
  nearest_pin: 'Did you hit the green?',
  pros_approach: 'Did you hit the green?',
  longest_drive: 'Did you hit the fairway?',
}

const STATUS_LABEL: Record<SideCompVerificationStatus, { text: string; color: string }> = {
  pending:  { text: 'Awaiting Playing Partner verification', color: '#a1791f' },
  verified: { text: 'Verified ✓', color: '#16a34a' },
  rejected: { text: 'Not confirmed by your Playing Partner', color: '#9ca3af' },
}

export default function SideCompEntryPanel({ tripId, sideCompId, compType, label, icon, currentUserId, groupMembers = [], roundId, myGroupId, holeNumber, onWouldLeadIfVerified, sharedDevicePartnerId, sharedDevicePartnerName }: Props) {
  // Side Games proxy entry — defaults to the submitter themselves, the
  // overwhelmingly common case, matching "the common case... should
  // already be selected" and "existing digital players... essentially
  // the same workflow they have now."
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentUserId)
  const [loading, setLoading] = useState(true)
  const [currentLeader, setCurrentLeader] = useState<SideCompLeader | null>(null)
  const [myQualified, setMyQualified] = useState<boolean | null>(null) // null = not yet answered
  const [myResultValue, setMyResultValue] = useState<string>('')
  const [myStatus, setMyStatus] = useState<SideCompVerificationStatus | null>(null)
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<SideCompSubmitResult | null>(null)
  // P0 follow-up — shared-device same-phone verification state.
  const [myEntryId, setMyEntryId] = useState<string | null>(null)
  const [requiredVerifierId, setRequiredVerifierId] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<'confirm' | 'reject' | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // Load current state — my own prior claim (if any) and the current
  // OFFICIAL (verified-only) leader, both from the GET, never inferred
  // locally. Two distinct code paths deliberately, not one function
  // reused for both:
  //
  // initialLoad (mount, or tripId/sideCompId/currentUserId changing)
  // resets every piece of state including the form inputs (myResultValue/
  // myQualified) — this is the per-account reset fix already in place,
  // preventing one user's stale typed value from bleeding into another's.
  //
  // pollStatus (every 15s thereafter, matching PendingVerificationCard's
  // own interval) ONLY updates server-driven state — myStatus,
  // currentLeader — and deliberately never touches myResultValue/
  // myQualified. This is the actual Package 1 fix: previously this
  // component fetched once on mount and never again, so a marker's
  // Confirm/Correct/Reject (happening on a different device entirely)
  // never reached the claimant's own screen until they navigated away
  // and back. Polling closes that gap — but doing it by re-running the
  // full reset-everything load would wipe out whatever the player is
  // actively typing into the distance field the moment a poll lands
  // mid-edit, trading one bug for a worse one. Splitting the two
  // concerns avoids that entirely.
  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      setLoading(true)
      setCurrentLeader(null)
      setMyQualified(null)
      setMyResultValue('')
      setMyStatus(null)
      setHasSubmittedOnce(false)
      setLastResult(null)
      setError(null)
      setMyEntryId(null)
      setRequiredVerifierId(null)
      try {
        const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries?playerId=${encodeURIComponent(selectedPlayerId)}`)
        if (!res.ok || cancelled) return
        const body = await res.json()
        if (cancelled) return
        setCurrentLeader(body.currentLeader ?? null)
        if (body.myEntry) {
          setHasSubmittedOnce(true)
          setMyQualified(body.myEntry.qualified)
          setMyStatus(body.myEntry.verificationStatus ?? null)
          setMyEntryId(body.myEntry.entryId ?? null)
          setRequiredVerifierId(body.myEntry.requiredVerifierId ?? null)
          if (body.myEntry.claimedValue != null) setMyResultValue(String(body.myEntry.claimedValue))
        }
      } catch { /* ignore — panel just shows the form with no prior state */ }
      if (!cancelled) setLoading(false)
    }

    async function pollStatus() {
      try {
        const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries?playerId=${encodeURIComponent(selectedPlayerId)}`)
        if (!res.ok || cancelled) return
        const body = await res.json()
        if (cancelled) return
        setCurrentLeader(body.currentLeader ?? null)
        if (body.myEntry) {
          setMyStatus(body.myEntry.verificationStatus ?? null)
          setMyEntryId(body.myEntry.entryId ?? null)
          setRequiredVerifierId(body.myEntry.requiredVerifierId ?? null)
        }
      } catch { /* ignore — next poll tries again; never surfaces an error for a background refresh */ }
    }

    void initialLoad()
    const interval = setInterval(() => void pollStatus(), 15000)
    return () => { cancelled = true; clearInterval(interval) }
    // selectedPlayerId included deliberately — switching "Result for"
    // must re-run the exact same full state reset as an account switch
    // already correctly does (see initialLoad's own reset block above),
    // not merely refetch on top of stale state left over from whichever
    // player was previously selected. This is the specific bug class
    // the brief explicitly warns against reintroducing.
  }, [tripId, sideCompId, currentUserId, selectedPlayerId])

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
      const body: Record<string, unknown> = { qualified, playerId: selectedPlayerId }
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
        // 1 Sep field-test bundle — the actual competitor this claim
        // was for, resolved from the same selectedPlayerId the request
        // body itself was already keyed by — never the authenticated
        // device operator, and never guessed from currentUserId.
        competitorPlayerId: selectedPlayerId,
        competitorPlayerName: resolveCompetitorDisplayName({ selectedPlayerId, currentUserId, groupMembers }),
      }
      // currentLeader here is the OFFICIAL (verified) leader — unaffected
      // by this submission, since a claim never writes an official
      // result. Shown for context only, so the player understands why
      // they might not be the "leader" on screen yet even if their claim
      // would win.
      setCurrentLeader(result.currentLeader)
      setHasSubmittedOnce(true)
      setMyStatus(result.verificationStatus)
      setMyEntryId(result.entryId)
      setRequiredVerifierId(result.requiredVerifierId)
      setLastResult(result)
      // GA4 / Product Analytics brief — "how often Side Games are
      // used." A genuinely completed action (claim submitted and
      // accepted by the server), not fired on every keystroke while
      // filling in the claim form above. compType is a fixed enum, not
      // free text — no PII risk.
      trackEvent('side_game_claimed', { tripId, compType })
      if (result.wouldLeadIfVerified) onWouldLeadIfVerified?.(result)
    } catch {
      setError('Couldn\u2019t save your claim — your score is unaffected. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // P0 follow-up — shared-device same-phone verification. Only ever
  // reachable when myStatus is genuinely 'pending' AND this specific
  // claim's own required_verifier_id (from the server) equals the
  // shared-device partner's id passed down by the scoring shell — the
  // server-side verify endpoint independently re-derives and validates
  // this exact pairing again before honouring it, so this client check
  // is purely about when to show the control, never the actual
  // authority decision. Reuses the existing verify endpoint entirely —
  // no new verification backend.
  async function verifyAsPartner(decision: 'confirm' | 'reject') {
    if (!myEntryId) return
    setVerifying(decision)
    setVerifyError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries/${myEntryId}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setVerifyError(body.error ?? "Couldn't save this verification. Please try again."); return }
      setMyStatus(body.verificationStatus ?? 'verified')
      if (body.currentLeader) setCurrentLeader(body.currentLeader)
    } catch {
      setVerifyError("Couldn't save this verification. Check your connection and try again.")
    } finally {
      setVerifying(null)
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

      {/* Side Games proxy entry — "Result for" selector. Only rendered
          when there's genuinely more than the submitter alone to choose
          from (groupMembers already includes the submitter themselves
          as "Me" — see the call site), so a solo player or a group of
          one sees nothing different from before this feature. Keeping
          this lightweight per the explicit UX instruction — a plain
          select, not a special "offline player" workflow. */}
      {groupMembers.length > 1 && (
        <div style={{ marginTop: 6 }}>
          <select
            value={selectedPlayerId}
            onChange={e => setSelectedPlayerId(e.target.value)}
            style={{
              width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #d9c9a3',
              background: '#fff', fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151',
            }}
          >
            {groupMembers.map(m => (
              <option key={m.id} value={m.id}>Result for: {m.id === currentUserId ? `Me — ${m.name}` : m.name}</option>
            ))}
          </select>
        </div>
      )}

      {myStatus && (
        <div style={{ marginTop: 4, fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: STATUS_LABEL[myStatus].color }}>
          {icon} {label}{myResultValue ? ` — ${myResultValue}m` : ''} · {STATUS_LABEL[myStatus].text}
        </div>
      )}

      {/* P0 follow-up — shared-device same-phone verification. Marnie
          has no device/session of her own to see the separate "awaiting
          verification" list on, so when her confirmation is what this
          specific claim needs, the action lives right here, next to the
          claim itself — the phone is handed to her for this one action,
          not a trip to another screen. Never rendered for a normal
          two-device pair (sharedDevicePartnerId is null there), and
          only when the server's own snapshotted required_verifier_id
          for this exact claim matches her — not shown just because
          shared-device mode is active in general. */}
      {myStatus === 'pending' && sharedDevicePartnerId && requiredVerifierId === sharedDevicePartnerId && (
        <div style={{ marginTop: 8, background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#7a5c00', marginBottom: 8 }}>
            Verification required — {sharedDevicePartnerName ?? 'your paper partner'}, please confirm this result
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={verifying !== null}
              onClick={() => void verifyAsPartner('confirm')}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#16a34a', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: verifying ? 0.6 : 1 }}
            >
              {verifying === 'confirm' ? '…' : '✓ Confirm'}
            </button>
            <button
              disabled={verifying !== null}
              onClick={() => void verifyAsPartner('reject')}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#ffffff', color: '#dc2626', border: '1.5px solid #fecaca', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: verifying ? 0.6 : 1 }}
            >
              {verifying === 'reject' ? '…' : '✕ Reject / Not correct'}
            </button>
          </div>
          {verifyError && <p style={{ color: '#dc2626', fontSize: 11, marginTop: 6, fontFamily: 'var(--font-body)' }}>{verifyError}</p>}
        </div>
      )}

      {lastResult && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 800, color: lastResult.wouldLeadIfVerified ? '#16a34a' : '#6b7280' }}>
          {lastResult.wouldLeadIfVerified
            ? '📸 Claim saved — awaiting your Playing Partner\u2019s verification'
            : 'Claim saved — awaiting your Playing Partner\u2019s verification'}
        </div>
      )}

      {/* Item 1 — "Take Photo / Upload Photo" directly in the existing
          Side Game entry flow, including proxy mode. Reuses
          MomentCapture entirely (the same component NewLeaderPrompt
          already uses elsewhere) — no second photo-upload
          implementation. Only rendered once a claim genuinely exists
          for this hole (lastResult, or an entry already loaded from a
          prior visit), matching "capture a photo of the achievement,"
          not an unconditional upload button unrelated to any result.
          proxyPlayerId is only set when selectedPlayerId genuinely
          differs from the authenticated caller — Alex stays
          authenticated throughout (this is a plain field on the
          Moment payload, not impersonation), and this is exactly the
          same undefined-means-self default MomentCapture and the
          moments route already use. */}
      {(lastResult || hasSubmittedOnce) && (
        <div style={{ marginTop: 8 }}>
          <MomentCapture
            tripId={tripId}
            roundId={roundId ?? null}
            holeNumber={holeNumber ?? null}
            myGroupId={myGroupId ?? null}
            proxyPlayerId={selectedPlayerId !== currentUserId ? selectedPlayerId : undefined}
            sideCompContext={{
              sideCompId,
              // 1 Sep field-test bundle — "generic photo Moment,
              // separate from the leader story" root cause. This was
              // `lastResult?.entryId ?? null` only — lastResult is
              // exclusively set by a submission happening in THIS
              // render session; it is never set by the initial-load
              // path above, which restores an EXISTING claim
              // (hasSubmittedOnce=true, myEntryId set) from a prior
              // visit. A player who claimed earlier, navigated away,
              // came back, and only then took the photo would have
              // hasSubmittedOnce=true and lastResult=null — this
              // condition already correctly shows the capture UI in
              // that case, but the entryId passed into it was silently
              // null, so the photo uploaded with no side_comp_entries
              // link at all. Not comp-type-specific in the code itself
              // — matches whichever comp's real-device test happened
              // to involve a page reload/revisit between claiming and
              // capturing, which explains why NTP and Longest Drive
              // showed different results on the same underlying bug.
              entryId: resolveSideCompMomentEntryId({ lastResultEntryId: lastResult?.entryId ?? null, restoredEntryId: myEntryId }),
              leadChangeId: null,
              compType,
              resultValue: lastResult?.claimedValue ?? (myResultValue ? Number(myResultValue) : null),
            }}
          />
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
