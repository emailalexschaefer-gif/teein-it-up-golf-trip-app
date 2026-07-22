'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { TripData, RoundRow } from '../TripDetailClient'
import { WizardNav } from './TripOverviewTab'
import BeginRoundModal from '@/components/scoring/BeginRoundModal'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'
interface Props { trip: TripData; isOrganiser: boolean; onTabChange: (t: Tab) => void }

// Group shape from the groups API response
interface GroupWithMembers {
  id: string; name: string; tee_time: string | null; sort_order: number
}

export default function TripRoundsTab({ trip, isOrganiser, onTabChange }: Props) {
  const router = useRouter()
  const sorted = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))

  const [beginRound, setBeginRound] = useState<RoundRow | null>(null)
  const [groups, setGroups] = useState<GroupWithMembers[]>([])
  const [groupMembers, setGroupMembers] = useState<Record<string, Array<{
    profile_id: string; full_name: string; playing_handicap: number | null; profile_handicap: number | null
  }>>>({})

  // Only load groups when the organiser intends to begin a round
  async function loadGroupsForModal() {
    try {
      const [gRes, mRes] = await Promise.all([
        fetch(`/api/trips/${trip.id}/groups`),
        Promise.resolve({ ok: true, json: async () => trip.trip_members }),
      ])
      if (!gRes.ok) return
      const groupData: GroupWithMembers[] = await gRes.json()
      setGroups(groupData)

      // Build group → members map from trip_members (already on the page)
      const byGroup: Record<string, Array<{ profile_id: string; full_name: string; playing_handicap: number | null; profile_handicap: number | null }>> = {}
      for (const g of groupData as GroupWithMembers[]) byGroup[g.id] = []

      for (const m of trip.trip_members) {
        if (!m.group_id || !byGroup[m.group_id]) continue
        if (m.role === 'organiser' && !(trip.organiser_is_playing)) continue
        byGroup[m.group_id].push({
          profile_id:       m.profile_id,
          full_name:        m.profiles?.full_name ?? 'Player',
          playing_handicap: m.playing_handicap ?? null,
          profile_handicap: m.profiles?.handicap ?? null,
        })
      }
      setGroupMembers(byGroup)
    } catch { /* silent — modal shows empty state */ }
  }

  const canBeginRound = (round: RoundRow) =>
    isOrganiser &&
    round.status === 'upcoming' &&
    (trip.status === 'live' || trip.status === 'ready' || trip.status === 'groups_ready')

  function openBeginModal(round: RoundRow) {
    setBeginRound(round)
    loadGroupsForModal()
  }

  const modalGroups = beginRound
    ? groups.map((g: GroupWithMembers) => ({
        id:       g.id,
        name:     g.name,
        tee_time: g.tee_time,
        players:  groupMembers[g.id] ?? [],
      }))
    : []

  return (
    <>
      <div className="space-y-4">
        <p className="s-label">Schedule</p>

        {sorted.length === 0 ? (
          <div className="card p-8 text-center">
            <p style={{ fontSize: 32, marginBottom: 8 }}>📅</p>
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>No rounds configured</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
              Rounds are added during trip creation. Edit the trip to add or change rounds.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((round, i) => (
              <RoundCard
                key={round.id}
                round={round}
                index={i}
                tripId={trip.id}
                isOrganiser={isOrganiser}
                canBegin={canBeginRound(round)}
                onBeginRound={() => openBeginModal(round)}
              />
            ))}
          </div>
        )}

        <WizardNav
          onBack={() => onTabChange('groups')} backLabel="← Groups"
          nextLabel="Overview →"
          onNext={() => onTabChange('overview')}
        />
      </div>

      {beginRound && (
        <BeginRoundModal
          tripId={trip.id}
          roundId={beginRound.id}
          roundName={beginRound.name}
          courseName={beginRound.course_name}
          holeCount={(beginRound.holes === 9 ? 9 : 18) as 9 | 18}
          teeTime={beginRound.tee_time}
          playDate={beginRound.play_date}
          groups={modalGroups}
          onClose={() => setBeginRound(null)}
        />
      )}
    </>
  )
}

interface RoundCardProps {
  round:    RoundRow
  index:    number
  tripId:   string
  isOrganiser: boolean
  canBegin: boolean
  onBeginRound: () => void
  key?: string
}

function RoundCard({ round, index, tripId, isOrganiser, canBegin, onBeginRound }: RoundCardProps) {
  const isLive      = round.status === 'active'
  const isCompleted = round.status === 'completed'

  return (
    <div className="card overflow-hidden" style={{ borderColor: isLive ? '#86efac' : '#d9c9a3' }}>
      {isLive && (
        <div style={{ background: '#1a4731', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8c96a', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            🟢 Round in progress — scoring underway
          </span>
        </div>
      )}

      <div className="flex items-start gap-4 p-4">
        {/* Round number badge */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: isLive
            ? 'linear-gradient(135deg, #166534, #1a4731)'
            : 'linear-gradient(135deg, #0f2d1c, #1a4731)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{index + 1}</span>
          <span style={{ fontFamily: 'var(--font-body)', color: 'rgba(232,201,106,0.5)', fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>Round</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 700, color: '#1a1a16', fontSize: 15 }}>{round.name}</p>
            <StatusPill status={round.status} />
          </div>

          {round.course_name && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#3d3929', marginBottom: 4 }}>{round.course_name}</p>
          )}

          <div className="flex items-center gap-3 flex-wrap" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', marginBottom: 10 }}>
            <span>📅 {new Date(round.play_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {round.tee_time && <span style={{ color: '#c9a84c', fontWeight: 700 }}>⏱ {round.tee_time}</span>}
            <span>⛳ {round.holes} holes</span>
            <span style={{ textTransform: 'capitalize' }}>Stableford</span>
          </div>

          {/* Actions */}
          {canBegin && (
            <button
              type="button"
              onClick={onBeginRound}
              style={{
                width: '100%', padding: '12px 18px',
                background: 'linear-gradient(135deg, #c9a84c, #e8c96a, #c9a84c)',
                border: 'none', borderRadius: 10, cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800,
                color: '#0f2d1c', boxShadow: '0 3px 12px rgba(201,168,76,0.4)',
              }}
            >
              Begin Round
            </button>
          )}

          {isLive && (
            <a
              href={`/trips/${tripId}/rounds/${round.id}/score`}
              style={{
                display: 'block', width: '100%', padding: '12px 18px', textAlign: 'center',
                background: 'linear-gradient(135deg, #2d7a52, #1a4731)',
                borderRadius: 10, textDecoration: 'none',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800,
                color: '#ffffff', boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
              }}
            >
              Continue Scoring →
            </a>
          )}

          {isCompleted && (
            <a
              href={`/trips/${tripId}/rounds/${round.id}/score`}
              style={{
                display: 'block', width: '100%', padding: '10px 18px', textAlign: 'center',
                background: '#f2e8d0', borderRadius: 10, textDecoration: 'none',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                color: '#1a4731', border: '1.5px solid #d9c9a3',
              }}
            >
              View Results
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, React.CSSProperties> = {
    upcoming:  { background: '#f8f4eb', color: '#7a7260', border: '1px solid #d9c9a3' },
    active:    { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' },
    completed: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
  }
  const labels: Record<string, string> = { upcoming: 'Upcoming', active: 'Live', completed: 'Completed' }
  return (
    <span style={{
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      padding: '3px 10px', borderRadius: 20, flexShrink: 0,
      ...( styles[status] ?? styles.upcoming),
    }}>
      {labels[status] ?? status}
    </span>
  )
}
