'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AmbroseTeamScorer from './AmbroseTeamScorer'
import { useTeamRound } from './useTeamRound'
import { deriveEntryViews, viewerMayScore } from '@/lib/ambrose/teamState'
import { buildHoleCells, nextHoleToScore, progressSummary, syncSummary } from '@/lib/ambrose/scorerModel'
import { driveRiskMessage } from '@/lib/ambrose/drives'
import { queueTeamScoreBounded, resolveTeamConflict, teamQueueSnapshot, createDexieTeamSyncRunner } from '@/lib/ambrose/teamQueue'
import type { TeamQueueEntry } from '@/lib/ambrose/teamQueueRules'
import { postTeamAction } from '@/lib/ambrose/teamApi'
import { card, body } from './styles'

// Coordinates the team scorer screen: server state (read), this device's offline queue (Dexie), and the upload loop. The presentation component
// stays free of network and database code. A score typed here is saved on THIS DEVICE first; the server decides whether it is accepted.
export default function AmbroseScorerContainer({ roundId, entryId }: { roundId: string; entryId?: string }) {
  const { state, viewerId, error, authLapsed, refresh } = useTeamRound(roundId)
  const [queue, setQueue] = useState<TeamQueueEntry[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const views = useMemo(() => (state ? deriveEntryViews(state) : []), [state])
  const mine = useMemo(() => views.find(v => (entryId ? v.entryId === entryId : viewerId ? v.memberIds.includes(viewerId) : false)) ?? null, [views, entryId, viewerId])

  const runnerRef = useRef<(() => Promise<void>) | null>(null)
  if (!runnerRef.current) runnerRef.current = createDexieTeamSyncRunner({
    pending: () => {}, attention: () => {}, complete: () => setSyncMsg(null), syncing: () => {}, failed: m => setSyncMsg(m),
  })
  const entryRef = useRef<string | null>(null)
  entryRef.current = mine?.entryId ?? null

  const reloadQueue = useCallback(async () => { if (entryRef.current) setQueue(await teamQueueSnapshot(entryRef.current)) }, [])
  const runSync = useCallback(async () => { await runnerRef.current!(); await reloadQueue(); await refresh() }, [reloadQueue, refresh])

  useEffect(() => { void reloadQueue() }, [reloadQueue, mine?.entryId])
  useEffect(() => {
    const onOnline = () => { void runSync() }
    window.addEventListener('online', onOnline)
    const t = setInterval(() => { void reloadQueue(); if (navigator.onLine) void runSync() }, 8000)
    return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
  }, [runSync, reloadQueue])

  if (!state || !viewerId) return <div style={card}><p role="status" style={body}>{error ?? 'Loading the scorecard…'}</p></div>
  if (!mine) return <div style={card}><p role="status" style={body}>{error ?? 'You are not on a team in this round.'}</p></div>

  const cells = buildHoleCells(mine.holes, mine.serverScores, queue, mine.openFlagHoleIds)
  const may = viewerMayScore(mine, viewerId, state.round.status)
  const current = picked ?? nextHoleToScore(cells)?.holeId ?? cells[cells.length - 1]?.holeId ?? null
  const holesRemaining = cells.filter(c => c.state === 'empty').length
  const drives = mine.drives?.map(d => ({ playerId: d.playerId, name: d.name, used: d.used, required: d.required })) ?? null
  const sync = syncSummary(queue)

  return (
    <>
      {(authLapsed || (error && !authLapsed)) && <div style={{ ...card, background: '#fff7e0' }}><p role="alert" style={{ ...body, color: '#7a5600' }}>{authLapsed ? 'Signed out of Teein’ It Up — sign in again. Your scores are safe on this device.' : error}</p></div>}
      {syncMsg && <div style={{ ...card, background: '#fff7e0' }}><p role="alert" style={{ ...body, color: '#7a5600' }}>{syncMsg}</p></div>}
      {notice && <div style={card}><p role="status" style={body}>{notice}</p></div>}
      <AmbroseTeamScorer
        teamName={mine.name} cells={cells} currentHoleId={current} progress={progressSummary(cells)} sync={sync}
        drives={drives} driveWarning={driveRiskMessage(mine.drives, holesRemaining)} canScore={may.may} notScorerMessage={may.may ? null : may.message}
        onSelectHole={setPicked}
        onSubmit={async v => {
          setNotice(null)
          const r = await queueTeamScoreBounded({ entryId: mine.entryId, holeId: v.holeId, grossScore: v.gross, isNoReturn: v.noReturn, drivePlayerId: v.drivePlayerId, seenRevision: v.seenRevision })
            .catch(() => ({ saved: false as const, reason: 'Could not save on this device. Try again.' }))
          if (!r.saved) { setNotice(r.reason); return }
          setPicked(null); await reloadQueue()
          if (navigator.onLine) void runSync()
        }}
        onResolveConflict={async (holeId, action) => {
          const row = [...queue].reverse().find(q => q.holeId === holeId && q.syncStatus === 'conflict')
          if (!row) return
          const problem = await resolveTeamConflict(row.clientId, action)
          if (problem) { setNotice(problem); return }
          await reloadQueue(); void runSync()
        }}
        onFlag={async holeId => {
          const r = await postTeamAction((u, i) => fetch(u, i), 'flag', { entry_id: mine.entryId, hole_id: holeId })
          setNotice(r.ok ? 'Query raised. The organiser will see it.' : r.message); await refresh()
        }}
      />
    </>
  )
}
