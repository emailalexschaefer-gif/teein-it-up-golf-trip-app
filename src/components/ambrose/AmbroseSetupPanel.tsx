'use client'

import { useState } from 'react'

import type { SetupModel } from '@/lib/ambrose/setupModel'
import type { GroupSuggestion } from '@/lib/ambrose/suggestTeams'
import { SHADES, card, h2, body, btnPrimary, btnOutline } from './styles'

// Organiser setup for an Ambrose round (presentation only). All rules are in setupModel.ts / suggestTeams.ts and, authoritatively, the database.
// Colour is never the only signal: every team carries a text label.

export interface SetupPlayer { id: string; name: string; handicap: number | null }
export interface SavedTeamView { entryId: string; name: string; label: string; shadeIndex: number; memberIds: string[]; scorerId: string | null; scorerConfirmed: boolean }

interface Props {
  model: SetupModel
  players: Record<string, SetupPlayer>
  groupNames: Record<string, string>
  suggestions: GroupSuggestion[]
  savedTeams: SavedTeamView[]
  busy?: boolean
  error?: string | null
  onMovePlayer: (groupId: string, playerId: string, direction: 'up' | 'down') => void
  onSaveGroupTeams: (groupId: string) => void
  /** The organiser names each team; a playing group is not a team. */
  onRenameTeam: (groupId: string, teamIndex: number, name: string) => void
  onConfirmScorer: (entryId: string, playerId: string) => void
  /** Audited correction before the first score: reopen a released round's set-up (reason required) and lock it again. Resolve with an error message or null. */
  onReopen: (reason: string) => Promise<string | null>
  onRelock: () => Promise<string | null>
}

const STEP_ICON = { done: '✓', todo: '•', blocked: '–' } as const
const STEP_COLOUR = { done: '#14532d', todo: '#6b6b60', blocked: '#9a6b00' } as const

export default function AmbroseSetupPanel(p: Props) {
  const { model } = p
  const name = (id: string) => p.players[id]?.name ?? 'Unknown player'
  return (
    <section aria-label="Ambrose setup">
      <div style={card}>
        <h2 style={h2}>Ambrose setup</h2>
        <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {model.steps.map(s => (
            <li key={s.key} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid #f1efe8' }}>
              <span aria-hidden style={{ width: 22, height: 22, borderRadius: 11, flex: '0 0 22px', textAlign: 'center', lineHeight: '22px', fontSize: 13, fontWeight: 800,
                background: s.status === 'done' ? '#e8f3ec' : '#f4f2ea', color: STEP_COLOUR[s.status] }}>{STEP_ICON[s.status]}</span>
              <div>
                <p style={{ ...body, color: '#1c1c17', fontWeight: 700 }}>{s.title}<span style={{ fontWeight: 600, color: STEP_COLOUR[s.status] }}> · {s.status === 'done' ? 'Done' : s.status === 'blocked' ? 'Not available yet' : 'To do'}</span></p>
                <p style={body}>{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {p.error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '10px 0 0' }}>{p.error}</p>}
        {!model.teamsEditable && <p role="status" style={{ ...body, marginTop: 10 }}>{model.teamsLockReason}</p>}
      </div>

      {p.suggestions.map(g => (
        <div key={g.groupId} style={card}>
          <h3 style={{ ...h2, fontSize: 15 }}>{p.groupNames[g.groupId] ?? 'Group'}</h3>
          <p style={body}>Suggested from the order below. Move players up or down to change who is paired, then save.</p>
          {g.teams.map((t, ti) => {
            const sh = SHADES[t.shadeIndex % SHADES.length]
            return (
              <div key={ti} style={{ background: sh.bg, border: `1px solid ${sh.border}`, borderRadius: 12, padding: 12, margin: '10px 0' }}>
                <label htmlFor={`team-name-${g.groupId}-${ti}`} style={{ display: 'block', margin: '0 0 4px', fontWeight: 800, fontSize: 13, color: sh.fg }}>{t.label} · team name</label>
                <input id={`team-name-${g.groupId}-${ti}`} value={t.name} maxLength={60} disabled={!model.teamsEditable || p.busy} onChange={e => p.onRenameTeam(g.groupId, ti, e.target.value)}
                  style={{ minHeight: 44, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1.5px solid ${sh.border}`, padding: '0 10px', fontSize: 15, fontWeight: 700, marginBottom: 6, background: '#fff' }} />
                {t.playerIds.map(id => <PlayerRow key={id} name={name(id)} hcp={p.players[id]?.handicap ?? null} disabled={!model.teamsEditable || p.busy} onMove={d => p.onMovePlayer(g.groupId, id, d)} />)}
              </div>
            )
          })}
          {g.unassigned.length > 0 && (
            <div role="alert" style={{ background: '#fff7e0', border: '1px solid #f0d88a', borderRadius: 12, padding: 12, margin: '10px 0' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 14, color: '#7a5600' }}>Not on a team</p>
              {g.unassigned.map(id => <PlayerRow key={id} name={name(id)} hcp={p.players[id]?.handicap ?? null} disabled={!model.teamsEditable || p.busy} onMove={d => p.onMovePlayer(g.groupId, id, d)} />)}
            </div>
          )}
          {g.issues.map((m, i) => <p key={i} style={{ ...body, color: '#7a5600', marginBottom: 6 }}>{m}</p>)}
          {g.teams.length > 0 && (
            <button type="button" style={{ ...btnOutline, opacity: model.teamsEditable && g.unassigned.length === 0 ? 1 : 0.5 }}
              disabled={!model.teamsEditable || p.busy || g.unassigned.length > 0 || g.teams.some(t => t.name.trim() === '')} onClick={() => p.onSaveGroupTeams(g.groupId)}>
              Save {g.teams.length === 1 ? 'team' : 'teams'}
            </button>
          )}
        </div>
      ))}

      {p.savedTeams.length > 0 && (
        <div style={card}>
          <h3 style={{ ...h2, fontSize: 15 }}>Saved teams and scorers</h3>
          <p style={body}>Each team has one scorer, and you confirm who it is. Other team members can flag a score but cannot change it.</p>
          {p.savedTeams.map(t => (
            <div key={t.entryId} style={{ borderTop: '1px solid #f1efe8', padding: '10px 0' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 14 }}>{t.name}</p>
              <label style={{ ...body, display: 'block', marginBottom: 4 }} htmlFor={`scorer-${t.entryId}`}>Scorer {t.scorerConfirmed ? '· confirmed' : '· not confirmed'}</label>
              <select id={`scorer-${t.entryId}`} value={t.scorerId ?? ''} disabled={p.busy}
                onChange={e => e.target.value && p.onConfirmScorer(t.entryId, e.target.value)}
                style={{ minHeight: 44, width: '100%', borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 10px', fontSize: 15 }}>
                <option value="">Choose the scorer…</option>
                {t.memberIds.map(id => <option key={id} value={id}>{name(id)}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        {model.blockers.length > 0 && <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>{model.blockers.map((b, i) => <li key={i} style={body}>{b}</li>)}</ul>}
        <p role="status" style={{ ...body, color: '#1c1c17', fontWeight: 700 }}>{model.startHandOff}</p>
        <p style={body}>Scoring is never started from this screen. The round is released and started with the existing My HQ controls.</p>
        {model.canReopen && <ReopenForm onReopen={p.onReopen} busy={p.busy} />}
        {model.canRelock && (
          <button type="button" style={{ ...btnOutline, width: '100%', marginTop: 10 }} disabled={p.busy} onClick={() => { void p.onRelock() }}>Lock team set-up again</button>
        )}
      </div>
    </section>
  )
}

function ReopenForm({ onReopen, busy }: { onReopen: (reason: string) => Promise<string | null>; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  if (!open) return <button type="button" style={{ ...btnOutline, width: '100%', marginTop: 10 }} onClick={() => setOpen(true)}>Reopen team set-up…</button>
  return (
    <div style={{ marginTop: 10 }}>
      <label htmlFor="reopen-reason" style={{ ...body, display: 'block', marginBottom: 4 }}>Why is set-up being reopened? (recorded in the audit trail)</label>
      <input id="reopen-reason" value={reason} maxLength={300} onChange={e => setReason(e.target.value)}
        style={{ minHeight: 44, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1.5px solid #d9d6c9', padding: '0 12px', fontSize: 16, marginBottom: 8 }} />
      <button type="button" style={{ ...btnPrimary, width: '100%', opacity: reason.trim() ? 1 : 0.5 }} disabled={busy || !reason.trim()}
        onClick={async () => { const m = await onReopen(reason.trim()); if (m) setMsg(m); else { setOpen(false); setReason('') } }}>Reopen set-up</button>
      {msg && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}

function PlayerRow({ name, hcp, disabled, onMove }: { name: string; hcp: number | null; disabled?: boolean; onMove: (d: 'up' | 'down') => void }) {
  const mv: React.CSSProperties = { minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid #d9d6c9', background: '#fff', fontSize: 16, cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{name}{hcp !== null && <span style={{ color: '#6b6b60', fontWeight: 500 }}> · HCP {hcp}</span>}</span>
      <button type="button" aria-label={`Move ${name} up`} style={mv} disabled={disabled} onClick={() => onMove('up')}>↑</button>
      <button type="button" aria-label={`Move ${name} down`} style={mv} disabled={disabled} onClick={() => onMove('down')}>↓</button>
    </div>
  )
}
