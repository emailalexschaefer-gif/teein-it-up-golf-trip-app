'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import AmbroseOrganiserContainer, { type OrganiserGroup } from './AmbroseOrganiserContainer'
import AmbroseLeaderboardContainer from './AmbroseLeaderboardContainer'
import type { SetupPlayer } from './AmbroseSetupPanel'
import { useTeamRound } from './useTeamRound'
import { summariseTeamRound } from '@/lib/ambrose/roundSummary'
import { deriveEntryViews } from '@/lib/ambrose/teamState'
import { ambroseCloseVerdict } from '@/lib/ambrose/closeGate'
import { card, h2, body, btnPrimary, btnOutline } from './styles'

// The organiser's Ambrose section, mounted by My HQ (behind the feature flag) for the SELECTED round. It adds nothing of its own to the round
// lifecycle: releasing and starting the round stay with the existing My HQ / Begin Round controls, and closing uses the EXISTING close route.
interface SetupContext { groups: { id: string; name: string; players: { profile_id: string; full_name: string; playing_handicap: number | null; profile_handicap: number | null }[] }[] }

export default function AmbroseHQSection({ tripId, roundId, roundName, roundStatus, onClosed }: { tripId: string; roundId: string; roundName: string; roundStatus: string; onClosed?: () => void }) {
  const { state, error } = useTeamRound(roundId)
  const [wantAmbrose, setWantAmbrose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeMsg, setCloseMsg] = useState<string | null>(null)
  const ctx = useQuery<SetupContext>({
    queryKey: ['setup-context', tripId, roundId],
    queryFn: async () => { const r = await fetch(`/api/trips/${tripId}/rounds/${roundId}/setup-context`); if (!r.ok) throw new Error('Could not load players.'); return r.json() },
    staleTime: 30_000,
  })
  const groups: OrganiserGroup[] = useMemo(() => (ctx.data?.groups ?? []).map(g => ({ groupId: g.id, groupName: g.name, playerIds: g.players.map(p => p.profile_id) })), [ctx.data])
  const players: Record<string, SetupPlayer> = useMemo(() => {
    const out: Record<string, SetupPlayer> = {}
    for (const g of ctx.data?.groups ?? []) for (const p of g.players) out[p.profile_id] = { id: p.profile_id, name: p.full_name, handicap: p.playing_handicap ?? p.profile_handicap }
    return out
  }, [ctx.data])
  const views = useMemo(() => (state ? deriveEntryViews(state) : []), [state])

  if (!state) return <div style={card}><p role="status" style={body}>{error ?? 'Loading Ambrose…'}</p></div>
  const hasConfig = !!state.config
  const upcoming = roundStatus === 'upcoming'
  if (!hasConfig && !upcoming) return null
  if (!hasConfig && !wantAmbrose) {
    return (
      <div style={card}>
        <h2 style={h2}>Ambrose (test feature)</h2>
        <p style={body}>Run this round as a two- or four-person Ambrose with team scoring. Not available to other users.</p>
        <button type="button" style={{ ...btnOutline, width: '100%', marginTop: 8 }} onClick={() => setWantAmbrose(true)}>Set up Ambrose for {roundName}</button>
      </div>
    )
  }
  if (ctx.isLoading) return <div style={card}><p role="status" style={body}>Loading players…</p></div>
  if (ctx.isError) return <div style={card}><p role="alert" style={{ ...body, color: '#b91c1c' }}>Could not load the players for this round.</p></div>

  const verdict = ambroseCloseVerdict(views.map(v => ({ name: v.name, withdrawn: false, completion: { complete: v.completion.complete } })))
  async function closeRound() {
    setClosing(true); setCloseMsg(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/close`, { method: 'POST' })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) setCloseMsg(j.error ?? `The round could not be closed (HTTP ${res.status}).`)
      else onClosed?.()
    } catch { setCloseMsg('No connection. The round was not closed.') } finally { setClosing(false) }
  }
  const sum = summariseTeamRound(state)
  return (
    <div>
      {hasConfig && roundStatus !== 'upcoming' && (
        <div style={card} aria-label="Team progress">
          <h2 style={h2}>Team progress</h2>
          <p style={{ ...body, color: '#1c1c17', fontWeight: 700 }}>{sum.completeTeams} of {sum.teams} teams complete · {sum.completionPct}%</p>
          <p style={body}>{sum.holesToScore > 0 ? `${sum.holesToScore} hole${sum.holesToScore === 1 ? '' : 's'} still to score. ` : ''}{sum.needsOrganiser > 0 ? `${sum.needsOrganiser} item${sum.needsOrganiser === 1 ? '' : 's'} need${sum.needsOrganiser === 1 ? 's' : ''} the organiser (No Returns, queries or drive requirements).` : 'Nothing is waiting on the organiser.'}</p>
        </div>
      )}
      <AmbroseOrganiserContainer roundId={roundId} tripId={tripId} groups={groups} players={players} />
      {hasConfig && roundStatus !== 'upcoming' && <AmbroseLeaderboardContainer roundId={roundId} roundLabel={roundName} />}
      {hasConfig && roundStatus === 'active' && (
        <div id="close-round-section" style={card}>
          <h2 style={h2}>Close round</h2>
          <p style={body}>{verdict.ok ? 'Every team is complete. The round can be closed.' : verdict.reason}</p>
          <button type="button" style={{ ...btnPrimary, width: '100%', marginTop: 8, opacity: verdict.ok ? 1 : 0.5 }} disabled={!verdict.ok || closing} onClick={closeRound}>{closing ? 'Closing…' : 'Close round'}</button>
          {closeMsg && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '8px 0 0' }}>{closeMsg}</p>}
        </div>
      )}
    </div>
  )
}
