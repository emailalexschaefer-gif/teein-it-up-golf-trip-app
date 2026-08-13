'use client'

import { useEffect, useState } from 'react'

/**
 * Side Competition result entry — shared between SelfMarkerScoreShell and
 * ScoreSessionShell (the same component, not two implementations, per
 * "reuse where practical"; this one is substantial enough to genuinely
 * warrant sharing, unlike the small badge icon lookups in Item 2).
 *
 * Strictly renders what the server decides. This component never
 * compares a submitted value against anything itself — every "who's
 * leading" fact on screen comes directly from a GET or the POST
 * response's `currentLeader`/`becameLeader` fields. If the server said
 * someone else is leading, that's what's shown, full stop.
 *
 * Longest Drive correction semantics (flagged, not hidden): V1's result
 * is ordinal ("I beat the current leader"), not a measured distance. If
 * a player corrects their own entry to un-qualify (says they didn't
 * actually hit the fairway after all) and they were the standing leader,
 * the server re-derives the new leader by walking the append-only log
 * for the next still-qualified entrant (see migration 038's
 * submit_longest_drive_entry). This is well-defined and implemented, but
 * genuinely more fragile than NTP's plain numeric comparison — flagging
 * this here again at the UI layer, not inventing any additional ordering
 * logic client-side to compensate.
 */
export interface SideCompLeader { playerId: string; playerName: string; resultValue: number | null }
export interface SideCompSubmitResult { entryId: string | null; becameLeader: boolean; currentLeader: SideCompLeader | null; leadChangeId: string | null }

interface Props {
  tripId: string
  sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'
  label: string
  icon: string
  currentUserId: string
  // Item 4 hook — deliberately not acted on yet in this component. The
  // parent scoring shell passes a callback so that when Capture the
  // Moment is built, it has entryId/leadChangeId to link the Moment to,
  // without this panel needing to know anything about Moments itself.
  onBecameLeader?: (result: SideCompSubmitResult) => void
}

const QUALIFY_QUESTION: Record<Props['compType'], string> = {
  nearest_pin: 'Did you hit the green?',
  pros_approach: 'Did you hit the green?',
  longest_drive: 'Did you hit the fairway?',
}

export default function SideCompEntryPanel({ tripId, sideCompId, compType, label, icon, currentUserId, onBecameLeader }: Props) {
  const [loading, setLoading] = useState(true)
  const [currentLeader, setCurrentLeader] = useState<SideCompLeader | null>(null)
  const [myQualified, setMyQualified] = useState<boolean | null>(null) // null = not yet answered
  const [myResultValue, setMyResultValue] = useState<string>('')
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<SideCompSubmitResult | null>(null)

  // Load current state once on mount — my own prior entry (if any) and
  // the current leader, both from the GET, never inferred locally.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/trips/${tripId}/side-comps/${sideCompId}/entries`)
        if (!res.ok || cancelled) return
        const body = await res.json()
        if (cancelled) return
        setCurrentLeader(body.currentLeader ?? null)
        if (body.myEntry) {
          setHasSubmittedOnce(true)
          setMyQualified(body.myEntry.qualified)
          if (body.myEntry.resultValue != null) setMyResultValue(String(body.myEntry.resultValue))
        }
      } catch { /* ignore — panel just shows the form with no prior state */ }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [tripId, sideCompId])

  async function submit(qualified: boolean, resultValue: number | null, claims: boolean | null) {
    setSubmitting(true)
    setError(null)
    // A Side Competition submission is NOT part of the existing offline
    // queue (Dexie/syncScoreQueue) — deliberately, not an oversight. That
    // queue works because a queued SCORE's outcome is fully known at
    // queue time (the Stableford formula is deterministic from inputs
    // already on the device). A side-comp submission's outcome
    // (becameLeader) is NOT knowable offline — it depends on whatever
    // every other player's current entry happens to be at the moment the
    // server actually processes it, which can change while this device
    // has no reception. Queuing it would mean either lying about
    // becameLeader at submission time (violating "the server decides
    // leadership, never the client") or turning Capture the Moment into
    // an async notification that fires long after the golfer has left
    // the hole — a fundamentally different, unproven UX. Building that
    // is real architecture, not a hardening-pass fix — flagged here and
    // in the delivery notes rather than improvised.
    //
    // What this DOES guarantee: a failed/offline side-comp submission
    // cannot interfere with normal score entry in any way — this
    // component shares no state, no queue, and no request with
    // queueScoreEntry/syncScoreQueue; a network failure here only ever
    // sets this component's own error state, nothing upstream.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('No connection right now — your score is safe, but this result hasn\u2019t saved. Try again once you have signal.')
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
      if (!res.ok) { setError(responseBody.error ?? "Couldn't save your result. Please try again."); return }
      const result: SideCompSubmitResult = {
        entryId: responseBody.entryId ?? null, becameLeader: !!responseBody.becameLeader,
        currentLeader: responseBody.currentLeader ?? null, leadChangeId: responseBody.leadChangeId ?? null,
      }
      setCurrentLeader(result.currentLeader)
      setHasSubmittedOnce(true)
      setLastResult(result)
      if (result.becameLeader) onBecameLeader?.(result)
    } catch {
      setError('Couldn\u2019t save your result — your score is unaffected. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null // avoids a flash of the "no leader yet" state before the real one loads

  const leaderLine = currentLeader
    ? `Current leader: ${currentLeader.playerName}${currentLeader.resultValue != null ? ` · ${currentLeader.resultValue}m` : ''}`
    : 'No leader yet — be the first!'

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8c96a' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#7a5c00' }}>
        {leaderLine}
      </div>

      {lastResult && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 800, color: lastResult.becameLeader ? '#16a34a' : '#6b7280' }}>
          {lastResult.becameLeader ? `🏁 NEW LEADER! ${leaderLine.replace('Current leader: ', '')}` : 'Result saved — current leader unchanged.'}
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
            {submitting ? '…' : hasSubmittedOnce ? 'Update' : 'Submit'}
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
          // No standing leader yet, or the current leader is already this
          // player — a qualifying drive is submitted directly; the server
          // decides leadership from there (no-leader-yet auto-becomes
          // leader, per migration 038).
          <div style={{ marginTop: 8 }}>
            <button
              disabled={submitting}
              onClick={() => void submit(true, null, null)}
              style={{ width: '100%', padding: '9px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {submitting ? '…' : hasSubmittedOnce ? 'Update' : 'Submit'}
            </button>
          </div>
        )
      )}

      {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6, fontFamily: 'var(--font-body)' }}>{error}</p>}
    </div>
  )
}
