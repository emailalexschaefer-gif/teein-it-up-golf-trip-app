'use client'

import { useMemo, useState } from 'react'
import AmbroseSetupPanel, { type SetupPlayer, type SavedTeamView } from './AmbroseSetupPanel'
import AmbroseOrganiserControls, { type OrganiserActions } from './AmbroseOrganiserControls'
import { useTeamRound } from './useTeamRound'
import { postTeamAction } from '@/lib/ambrose/teamApi'
import { suggestTeams, type SuggestFormat } from '@/lib/ambrose/suggestTeams'
import { buildSetupModel } from '@/lib/ambrose/setupModel'
import { deriveEntryViews } from '@/lib/ambrose/teamState'
import { card, h2, body, btnPrimary, btnOutline } from './styles'

// Organiser container for ONE round. It sits inside the existing My HQ round set-up (the parent supplies the playing groups and the "start scoring"
// hand-off); it is not a separate organiser workflow. Authority is the database's: this only sends requests and shows the answer.
export interface OrganiserGroup { groupId: string; groupName: string; playerIds: string[] }
interface Props {
  roundId: string; tripId: string
  groups: OrganiserGroup[]
  players: Record<string, SetupPlayer>
}

const call = (action: Parameters<typeof postTeamAction>[1], body: Record<string, unknown>) => postTeamAction((u, i) => fetch(u, i), action, body)

export default function AmbroseOrganiserContainer({ roundId, tripId, groups, players }: Props) {
  const { state, error, refresh } = useTeamRound(roundId)
  const [order, setOrder] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map(g => [g.groupId, g.playerIds])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pickFormat, setPickFormat] = useState<SuggestFormat>('ambrose_4')
  const [minDrives, setMinDrives] = useState('')
  const [nameOverride, setNameOverride] = useState<Record<string, string>>({})

  const views = useMemo(() => (state ? deriveEntryViews(state) : []), [state])
  const format = (state?.config?.format ?? null) as SuggestFormat | null
  const savedMembers = useMemo(() => new Set((state?.members ?? []).map(m => m.player_id)), [state])
  const suggestions = useMemo(() => (format ? suggestTeams(format, groups.map(g => ({ groupId: g.groupId, groupName: g.groupName, playerIdsInSlotOrder: order[g.groupId] ?? g.playerIds })), savedMembers) : [])
    .map(g => ({ ...g, teams: g.teams.map((t, i) => ({ ...t, name: nameOverride[`${g.groupId}:${i}`] ?? t.name })) })), [format, groups, order, savedMembers, nameOverride])

  if (!state) return <div style={card}><p role="status" style={body}>{error ?? 'Loading…'}</p></div>

  const expected = (state.config?.team_size ?? (pickFormat === 'ambrose_2' ? 2 : 4)) as 2 | 4
  const model = buildSetupModel({
    formatConfigured: !!state.config, expectedSize: expected,
    unassignedPlayerCount: suggestions.reduce((a, g) => a + g.unassigned.length, 0),
    unsavedSuggestionCount: suggestions.reduce((a, g) => a + g.teams.length, 0),
    entries: views.map(v => ({ entryId: v.entryId, teamName: v.name, memberCount: v.memberIds.length, expectedSize: expected, scorerConfirmed: v.scorerConfirmed, handicapLocked: v.handicapLocked })),
    handicapApproved: false, roundReleased: state.round.status !== 'upcoming' || !!state.round.setup_released, acceptedScoresExist: state.scores.length > 0, setupReopened: !!state.config?.setup_reopened_at,
  })
  const saved: SavedTeamView[] = views.map((v, i) => ({ entryId: v.entryId, name: v.name, label: 'Team', shadeIndex: i % 2, memberIds: v.memberIds, scorerId: v.scorerId, scorerConfirmed: v.scorerConfirmed }))
  const groupNames = Object.fromEntries(groups.map(g => [g.groupId, g.groupName]))
  const closed = state.round.status === 'completed' || state.round.status === 'cancelled'

  async function guarded(f: () => Promise<string | null>) {
    setBusy(true); setErr(null)
    try { const m = await f(); if (m) setErr(m) } finally { setBusy(false); await refresh() }
  }
  const fail = (r: Awaited<ReturnType<typeof call>>): string | null => (r.ok ? null : r.message)

  const actions: OrganiserActions = {
    overrideScore: async (entryId, holeId, gross, reason, baseRevision) => { const r = fail(await call('submit', { client_id: crypto.randomUUID(), entry_id: entryId, hole_id: holeId, gross_score: gross, is_no_return: false, base_revision: baseRevision, reason })); await refresh(); return r },
    resolveNoReturn: async (entryId, holeId, baseRevision, reason) => { const r = fail(await call('resolve_no_return', { entry_id: entryId, hole_id: holeId, base_revision: baseRevision, reason })); await refresh(); return r },
    releaseLock: async (entryId, holeId, reason) => { const r = fail(await call('unlock', { entry_id: entryId, hole_id: holeId, reason })); await refresh(); return r },
    resolveFlag: async (flagId, status, note) => { const r = fail(await call('resolve_flag', { flag_id: flagId, status, note: note || undefined })); await refresh(); return r },
    waiveDrive: async (entryId, reason) => { const r = fail(await call('waive_drive', { entry_id: entryId, reason })); await refresh(); return r },
  }
  return (
    <>
      {!state.config && (
        <div style={card}>
          <h2 style={h2}>Choose the Ambrose format</h2>
          <p style={body}>Two-person pairs or four-person teams. Net results stay off until the handicap rules are verified; gross scoring works now.</p>
          <div role="radiogroup" aria-label="Team size" style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
            {(['ambrose_2', 'ambrose_4'] as const).map(f => (
              <button key={f} type="button" role="radio" aria-checked={pickFormat === f} onClick={() => setPickFormat(f)}
                style={{ ...btnOutline, flex: 1, background: pickFormat === f ? '#e8f3ec' : '#fff' }}>{f === 'ambrose_2' ? 'Two-person' : 'Four-person'}</button>
            ))}
          </div>
          <label htmlFor="min-drives" style={{ ...body, display: 'block', marginBottom: 4 }}>Minimum drives per player (optional — leave empty to not track drives)</label>
          <input id="min-drives" inputMode="numeric" value={minDrives} onChange={e => setMinDrives(e.target.value.replace(/\D/g, '').slice(0, 2))}
            style={{ minHeight: 44, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 12px', fontSize: 16, marginBottom: 12 }} />
          <button type="button" style={{ ...btnPrimary, width: '100%' }} disabled={busy}
            onClick={() => guarded(async () => fail(await call('configure_round', { round_id: roundId, format: pickFormat, method: 'gross_only', min_drives_per_player: minDrives === '' ? null : Number(minDrives) })))}>Use this format</button>
          {err && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{err}</p>}
        </div>
      )}
      {state.config && (
        <AmbroseSetupPanel model={model} players={players} groupNames={groupNames} suggestions={suggestions} savedTeams={saved} busy={busy} error={err}
          onMovePlayer={(groupId, playerId, dir) => setOrder(o => {
            const cur = [...(o[groupId] ?? [])]; const i = cur.indexOf(playerId); const j = dir === 'up' ? i - 1 : i + 1
            if (i < 0 || j < 0 || j >= cur.length) return o
            ;[cur[i], cur[j]] = [cur[j], cur[i]]; return { ...o, [groupId]: cur }
          })}
          onRenameTeam={(groupId, i, name) => setNameOverride(o => ({ ...o, [`${groupId}:${i}`]: name }))}
          onSaveGroupTeams={groupId => guarded(async () => {
            const g = suggestions.find(s => s.groupId === groupId); if (!g) return null
            for (const t of g.teams) {
              let teamId: string | null = null
              const c = await call('create_team', { trip_id: tripId, name: t.name.trim() })
              if (c.ok) teamId = String(c.body.team_id)
              else if (c.body?.outcome === 'duplicate_name') teamId = state.teams.find(x => x.name.trim().toLowerCase() === t.name.trim().toLowerCase())?.id ?? null
              if (!teamId) return c.ok ? 'The team could not be created.' : c.message
              const s = await call('save_entry', { round_id: roundId, team_id: teamId, member_ids: t.playerIds, group_id: t.groupId })
              if (!s.ok) return s.message
            }
            return null
          })}
          onConfirmScorer={(entryId, playerId) => guarded(async () => fail(await call('assign_scorer', { entry_id: entryId, scorer_id: playerId })))}
          onReopen={async reason => { let m: string | null = null; await guarded(async () => { m = fail(await call('reopen_setup', { round_id: roundId, reason })); return null }); return m }}
          onRelock={async () => { let m: string | null = null; await guarded(async () => { m = fail(await call('relock_setup', { round_id: roundId })); return m }); return m }} />
      )}
      {views.length > 0 && <AmbroseOrganiserControls views={views} flags={state.flags.filter(f => f.status === 'open').map(f => ({ id: f.id, entryId: f.entry_id, holeId: f.hole_id }))} actions={actions} names={state.names} closed={closed} />}
    </>
  )
}
