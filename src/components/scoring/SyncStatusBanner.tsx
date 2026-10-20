'use client'

import React, { useState } from 'react'
import { useSyncStore } from '@/store/syncStore'
import { deriveSyncStatus } from '@/lib/db/syncStatus'
import { requeueRejectedEntry, discardRejectedEntry, resolveConflictEntry } from '@/lib/db/dexie'
import { refreshQueueCounts, syncScoreQueue } from '@/lib/db/sync'
import type { OfflineScoreEntry } from '@/types/app'

/**
 * Offline-scoring Phase B — in-flow connectivity banner for the scoring
 * screen. The wording comes from deriveSyncStatus (real queue state only).
 * It is shown only for the states a player needs to ACT on or be warned
 * about (offline, no connection, failed, refused); "syncing" and "all
 * synced" stay in the quiet label above the action tray.
 *
 * Conflicts (the server holds a DIFFERENT, newer value) are shown with both
 * values. A generic retry is never offered for them: anyone may accept the
 * server's value; replacing it is organiser-only and needs a confirmation.
 *
 * Refused scores (D7) are never discarded automatically. A player can
 * retry them. Discarding is an explicit, confirmed action and is offered
 * to the organiser only; everyone else is told to ask the organiser.
 */

const TONE: Record<string, { bg: string; border: string; text: string }> = {
  warn: { bg: '#fffbeb', border: '#fde68a', text: '#7a5c00' },
  bad:  { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
}

interface Props {
  /** scorecard ids belonging to THIS round (own + marked card) */
  roundScorecardIds: string[]
  /** hole id -> hole number, for THIS round, to describe refused scores */
  holeNumberById: Record<string, number>
  isOrganiser: boolean
}

export default function SyncStatusBanner({ roundScorecardIds, holeNumberById, isOrganiser }: Props) {
  const online = useSyncStore(s => s.online)
  const syncState = useSyncStore(s => s.syncState)
  const pendingCount = useSyncStore(s => s.pendingCount)
  const rejectedCount = useSyncStore(s => s.rejectedCount)
  const rejectedEntries = useSyncStore(s => s.rejectedEntries)
  const lastFailure = useSyncStore(s => s.lastFailure)

  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [otherOpen, setOtherOpen] = useState(false)

  // 18 Oct field test -- the device queue is shared by every round and event,
  // so refused scores left over from OTHER rounds used to be reported here as
  // this round's red "need review" error (and counted in it). Split them: only
  // refusals on THIS round's scorecards drive the red status; older ones get a
  // calm, separate notice. Nothing is deleted or hidden -- they stay on the
  // device and remain reviewable. If the entry details could not be read, fall
  // back to the total so a refusal is never hidden.
  const detailKnown = rejectedEntries.length > 0
  const hereEntries = detailKnown ? rejectedEntries.filter(e => roundScorecardIds.includes(e.scorecardId)) : []
  const otherEntries = detailKnown ? rejectedEntries.filter(e => !roundScorecardIds.includes(e.scorecardId)) : []
  const rejectedHere = detailKnown ? hereEntries.length : rejectedCount

  const status = deriveSyncStatus({ online, syncState, pendingCount, rejectedCount: rejectedHere, lastFailure })
  const showMain = status.kind === 'offline' || status.kind === 'unreachable' || status.kind === 'failed' || status.kind === 'rejected' || !!message
  const showOther = otherEntries.length > 0
  if (!showMain && !showOther) return null
  const tone = TONE[status.tone] ?? TONE.warn

  async function retry(clientId: string) {
    setBusy(true)
    try {
      await requeueRejectedEntry(clientId)
      await refreshQueueCounts()
      void syncScoreQueue()
    } finally { setBusy(false) }
  }

  async function resolve(clientId: string, action: 'accept_server' | 'replace_with_mine') {
    setBusy(true)
    setMessage(null)
    try {
      const refusal = await resolveConflictEntry(clientId, action, isOrganiser)
      if (refusal) { setMessage(refusal); return }
      setReplaceId(null)
      await refreshQueueCounts()
      if (action === 'replace_with_mine') void syncScoreQueue()
      else setMessage("The server's score was kept. Refresh this page to see it on the scorecard.")
    } finally { setBusy(false) }
  }

  async function discard(clientId: string) {
    setBusy(true)
    try {
      await discardRejectedEntry(clientId)
      setConfirmId(null)
      await refreshQueueCounts()
    } finally { setBusy(false) }
  }

  const btn: React.CSSProperties = {
    border: `1px solid ${tone.border}`, background: '#fff', color: tone.text, borderRadius: 8,
    padding: '6px 12px', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', minHeight: 32,
  }

  function renderEntry(e: OfflineScoreEntry) {
    const inThisRound = roundScorecardIds.includes(e.scorecardId)
    const holeNo = holeNumberById[e.holeId]
    const where = inThisRound && holeNo ? `Hole ${holeNo}` : 'Another round'
    const mine = e.isNoReturn ? 'Pick-up' : String(e.grossScore ?? '—')
    const theirs = e.conflict ? (e.conflict.serverNoReturn ? 'Pick-up' : String(e.conflict.serverGross ?? '—')) : ''
    if (e.conflict) {
      return (
        <div key={e.clientId} style={{ background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 8, padding: 10 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#1a1a16', fontWeight: 700 }}>
            {where} · {e.captureRole === 'marker' ? 'playing partner' : 'own'} score — two different scores
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#1a1a16', marginTop: 4 }}>
            On this phone: <strong>{mine}</strong> · Recorded on the server: <strong>{theirs}</strong>
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            The server already holds a newer score for this hole, so yours was not applied. Your score is still kept here until you decide.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button style={btn} disabled={busy} onClick={() => void resolve(e.clientId, 'accept_server')}>Keep the server&apos;s score ({theirs})</button>
            {isOrganiser && replaceId !== e.clientId && (
              <button style={btn} disabled={busy} onClick={() => setReplaceId(e.clientId)}>Use this phone&apos;s score ({mine})…</button>
            )}
          </div>
          {isOrganiser && replaceId === e.clientId && (
            <div style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#991b1b' }}>
              Replace the recorded score ({theirs}) with this phone&apos;s score ({mine})? Check the paper scorecard first. A score you have overridden as organiser stays locked.
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button style={btn} disabled={busy} onClick={() => setReplaceId(null)}>Cancel</button>
                <button style={{ ...btn, background: '#991b1b', color: '#fff', border: '1px solid #991b1b' }} disabled={busy} onClick={() => void resolve(e.clientId, 'replace_with_mine')}>Yes, replace it</button>
              </div>
            </div>
          )}
          {!isOrganiser && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginTop: 6 }}>
              If this phone&apos;s score is the right one, ask the organiser to correct it from My HQ.
            </div>
          )}
        </div>
      )
    }
    return (
      <div key={e.clientId} style={{ background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 8, padding: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#1a1a16', fontWeight: 700 }}>
          {where} · {e.captureRole === 'marker' ? 'playing partner' : 'own'} score {mine}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          Refused by the server: {e.lastError ?? 'unknown reason'}. Kept on this device.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button style={btn} disabled={busy} onClick={() => void retry(e.clientId)}>Try again</button>
          {isOrganiser && confirmId !== e.clientId && (
            <button style={btn} disabled={busy} onClick={() => setConfirmId(e.clientId)}>Discard…</button>
          )}
        </div>
        {isOrganiser && confirmId === e.clientId && (
          <div style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#991b1b' }}>
            Remove this score from this phone permanently? It was never accepted by the server, so it will be lost.
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button style={btn} disabled={busy} onClick={() => setConfirmId(null)}>Keep it</button>
              <button style={{ ...btn, background: '#991b1b', color: '#fff', border: '1px solid #991b1b' }} disabled={busy} onClick={() => void discard(e.clientId)}>Yes, discard</button>
            </div>
          </div>
        )}
        {!isOrganiser && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginTop: 6 }}>
            Ask the organiser to resolve this score; they can enter it from My HQ.
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    {showMain && (
    <div role="status" style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
      {status.label && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: tone.text }}>{status.label}</div>
      )}

      {message && (
        <div role="alert" style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: tone.text, marginTop: 4 }}>{message}</div>
      )}

      {status.kind === 'offline' && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: tone.text, marginTop: 2 }}>
          Keep this screen open. If a score does not show as saved on this device, write it on the paper card.
        </div>
      )}

      {status.kind === 'rejected' && (
        <>
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button style={btn} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Review'}</button>
          </div>
          {open && (
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              {hereEntries.map(renderEntry)}
            </div>
          )}
        </>
      )}
    </div>
    )}

    {/* Refused scores from OTHER rounds: informational, not a problem with
        this round. Kept on the device; reviewable and, for the organiser,
        discardable with a confirmation (same actions as above). */}
    {showOther && (
      <div role="status" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#374151' }}>
          {otherEntries.length === 1 ? '1 older score from another round was' : `${otherEntries.length} older scores from other rounds were`} not accepted by the server — kept on this device.
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          This doesn&apos;t affect the round you&apos;re scoring.
        </div>
        <div style={{ marginTop: 6 }}>
          <button style={btn} onClick={() => setOtherOpen(o => !o)}>{otherOpen ? 'Hide' : 'Review'}</button>
        </div>
        {otherOpen && (
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {otherEntries.map(renderEntry)}
          </div>
        )}
      </div>
    )}
    </>
  )
}
