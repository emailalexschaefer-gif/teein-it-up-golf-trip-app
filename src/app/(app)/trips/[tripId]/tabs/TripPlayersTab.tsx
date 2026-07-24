'use client'

import { useState } from 'react'
import Image from 'next/image'
import { initials, avatarColor, formatHandicap, cn } from '@/lib/utils'
import type { TripData, TripMemberRow } from '../TripDetailClient'
import { WizardNav } from './TripOverviewTab'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'
interface Props {
  trip: TripData; currentUserId: string; isOrganiser: boolean
  onRefresh: () => void; onTabChange: (t: Tab) => void
}

export default function TripPlayersTab({ trip, currentUserId, isOrganiser, onRefresh, onTabChange }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)
  const [editingHcp, setEditingHcp] = useState<string | null>(null)  // memberId
  const [hcpValue, setHcpValue]     = useState('')
  const [hcpNone, setHcpNone]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [hcpError, setHcpError]     = useState<string | null>(null)

  const organiserMember    = trip.trip_members.find(m => m.role === 'organiser')
  const players            = trip.trip_members.filter(m => m.role === 'player')
  const organiserIsPlaying = trip.organiser_is_playing ?? false
  const displayPlayers: TripMemberRow[] = organiserIsPlaying && organiserMember
    ? [organiserMember, ...players]
    : players

  const expected    = trip.expected_players ?? 0
  const playerCount = organiserIsPlaying ? players.length + 1 : players.length
  const over        = expected > 0 && playerCount > expected
  const remaining   = expected > 0 && !over ? expected - playerCount : null
  const overBy      = over ? playerCount - expected : 0

  async function removePlayer(member: TripMemberRow) {
    if (!confirm(`Remove ${member.profiles?.full_name ?? 'this player'}?`)) return
    setRemoving(member.id)
    try {
      const res = await fetch(`/api/trips/${trip.id}/members/${member.id}`, { method: 'DELETE' })
      if (res.ok) onRefresh()
      else { const d = await res.json().catch(() => ({})); setHcpError(d.error ?? 'Could not remove player. Please try again.') }
    } finally { setRemoving(null) }
  }

  function openHcpEdit(member: TripMemberRow) {
    setEditingHcp(member.id)
    setHcpError(null)
    const hcp = member.playing_handicap
    if (hcp === null || hcp === undefined) {
      setHcpValue(''); setHcpNone(false)
    } else {
      setHcpValue(String(hcp)); setHcpNone(false)
    }
  }

  async function saveHcp(memberId: string) {
    setSaving(true)
    const playing_handicap = hcpNone ? null : (hcpValue === '' ? null : parseFloat(hcpValue))
    const res = await fetch(`/api/trips/${trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playing_handicap }),
    })
    setSaving(false)
    if (res.ok) { setEditingHcp(null); setHcpError(null); onRefresh() }
    else {
      const d = await res.json().catch(() => ({}))
      const msg = (d.error ?? '').toLowerCase()
      if (msg.includes('schema cache') || msg.includes('column') || msg.includes('does not exist')) {
        setHcpError('Handicap column not set up in database. Run migration 013 in Supabase SQL Editor.')
      } else {
        setHcpError(d.error ?? 'Could not save handicap. Please try again.')
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Stat strip ───────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className={cn('flex text-center', expected > 0 ? 'divide-x' : '')} style={{ borderColor: '#ede0c4' }}>
          <div className="flex-1 px-3">
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#1a4731' }}>{playerCount}</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Joined</p>
          </div>
          {expected > 0 && (
            <>
              <div className="flex-1 px-3">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#1a1a16' }}>{expected}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Expected</p>
              </div>
              <div className="flex-1 px-3">
                {over ? (
                  <>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#b45309' }}>+{overBy}</p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b45309' }}>Over capacity</p>
                  </>
                ) : (
                  <>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: remaining === 0 ? '#1a4731' : '#d97706' }}>
                      {remaining}
                    </p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Remaining</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── No players guidance ──────────────────────────────────────── */}
      {playerCount === 0 && isOrganiser && (
        <div style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 12, padding: '12px 14px', fontFamily: 'var(--font-body)', fontSize: 12, color: '#92400e' }}>
          No players have joined yet. Share the invite link from the trip header.
        </div>
      )}

      {/* ── Organiser ────────────────────────────────────────────────── */}
      {organiserMember && (
        <section>
          <p className="s-label" style={{ marginBottom: 8 }}>
            Organiser{organiserIsPlaying ? ' · also playing' : ''}
          </p>
          <div className="card">
            <PlayerRow
              member={organiserMember} currentUserId={currentUserId}
              roleLabel={organiserIsPlaying ? 'Organiser · Player' : 'Organiser'}
              isOrganiser={isOrganiser}
              editingHcp={editingHcp} hcpValue={hcpValue} hcpNone={hcpNone}
              saving={saving} hcpError={hcpError}
              onEditHcp={() => openHcpEdit(organiserMember)}
              onHcpChange={(v) => setHcpValue(v)}
              onHcpNoneChange={(v) => setHcpNone(v)}
              onSaveHcp={() => saveHcp(organiserMember.id)}
              onCancelHcp={() => { setEditingHcp(null); setHcpError(null) }}
            />
          </div>
        </section>
      )}

      {/* ── Players ──────────────────────────────────────────────────── */}
      <section>
        <p className="s-label" style={{ marginBottom: 8 }}>
          Players ({playerCount}){organiserIsPlaying ? ' · incl. organiser' : ''}
        </p>
        {displayPlayers.length === 0 ? (
          <div className="card p-8 text-center">
            <p style={{ fontSize: 32, marginBottom: 8 }}>👥</p>
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>No players yet</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Share the invite link from the trip header.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {displayPlayers.map((member, i) => (
              <div key={member.id} style={{ borderTop: i > 0 ? '1px solid #ede0c4' : 'none' }}>
                <PlayerRow
                  member={member} currentUserId={currentUserId}
                  roleLabel={member.role === 'organiser' ? 'Organiser · Player' : undefined}
                  flex
                  isOrganiser={isOrganiser}
                  canRemove={isOrganiser && member.role === 'player' && member.profile_id !== currentUserId}
                  removing={removing === member.id}
                  onRemove={() => removePlayer(member)}
                  editingHcp={editingHcp} hcpValue={hcpValue} hcpNone={hcpNone}
                  saving={saving} hcpError={hcpError}
                  onEditHcp={() => openHcpEdit(member)}
                  onHcpChange={(v) => setHcpValue(v)}
                  onHcpNoneChange={(v) => setHcpNone(v)}
                  onSaveHcp={() => saveHcp(member.id)}
                  onCancelHcp={() => { setEditingHcp(null); setHcpError(null) }}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <WizardNav
        onBack={() => onTabChange('overview')} backLabel="← Overview"
        onNext={() => onTabChange('groups')} nextLabel="Create Playing Groups →"
      />
    </div>
  )
}

interface PlayerRowProps {
  member: TripMemberRow; currentUserId: string
  roleLabel?: string; flex?: boolean
  isOrganiser: boolean; canRemove?: boolean; removing?: boolean
  onRemove?: () => void
  editingHcp: string | null; hcpValue: string; hcpNone: boolean; saving: boolean
  hcpError: string | null
  onEditHcp: () => void
  onHcpChange: (v: string) => void
  onHcpNoneChange: (v: boolean) => void
  onSaveHcp: () => void
  onCancelHcp: () => void
}

function PlayerRow({
  member, currentUserId, roleLabel, flex,
  isOrganiser, canRemove, removing, onRemove,
  editingHcp, hcpValue, hcpNone, saving, hcpError,
  onEditHcp, onHcpChange, onHcpNoneChange, onSaveHcp, onCancelHcp,
}: PlayerRowProps) {
  const name     = member.profiles?.full_name || 'Player'
  const isYou    = member.profile_id === currentUserId
  const color    = avatarColor(member.profile_id)
  const isEditingThis = editingHcp === member.id

  return (
    <div className={cn('px-4 py-3', flex && 'flex-1')}>
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        {member.profiles?.avatar_url ? (
          <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ position: 'relative', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            <Image src={member.profiles.avatar_url} alt={name} fill sizes="40px" className="object-cover" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white text-sm"
            style={{ backgroundColor: color, border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            {initials(name)}
          </div>
        )}

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', fontSize: 13 }} className="truncate">
              {name}{isYou && <span style={{ color: '#7a7260', fontSize: 11, marginLeft: 4 }}>(you)</span>}
            </p>
            {/* HCP badge */}
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
              color: member.playing_handicap !== null && member.playing_handicap !== undefined ? '#1a4731' : (member.profiles?.handicap !== null && member.profiles?.handicap !== undefined ? '#7a7260' : '#a89e88'),
            }}>
              {formatHandicap(member.playing_handicap, member.profiles?.handicap)}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>
            {roleLabel ?? (member.role === 'organiser' ? 'Organiser' : 'Player')}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOrganiser && !isEditingThis && (
            <button onClick={onEditHcp}
              style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Edit HCP
            </button>
          )}
          {canRemove && (
            <button disabled={removing} onClick={onRemove}
              style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', opacity: removing ? 0.4 : 1 }}>
              {removing ? '…' : 'Remove'}
            </button>
          )}
        </div>
      </div>

      {/* Inline handicap editor */}
      {isEditingThis && (
        <div style={{
          marginTop: 10, background: '#f0fdf4', borderRadius: 10, padding: '10px 12px',
          border: '1px solid #86efac',
        }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 6 }}>
            Edit playing handicap
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
            Changing this does not update the player&apos;s permanent profile handicap.
          </p>
          {hcpError && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
              {hcpError}
            </p>
          )}
          {!hcpNone && (
            <input
              type="number" min="0" max="54" step="0.1"
              value={hcpValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHcpChange(e.target.value)}
              placeholder="e.g. 14 or 14.5"
              style={{
                width: '100%', borderRadius: 8, border: '1px solid #d9c9a3',
                padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-body)',
                marginBottom: 6, outline: 'none',
              }}
            />
          )}
          <label className="flex items-center gap-2 mb-8" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={hcpNone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { onHcpNoneChange(e.target.checked); if (e.target.checked) onHcpChange('') }}
              className="rounded" />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280' }}>No official handicap</span>
          </label>
          <div className="flex gap-2">
            <button onClick={onSaveHcp} disabled={saving} style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              background: '#1a4731', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#ffffff',
              opacity: saving ? 0.5 : 1,
            }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={onCancelHcp} style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid #d9c9a3', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260',
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
