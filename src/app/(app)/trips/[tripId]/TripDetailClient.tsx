'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn, formatTripDateRange } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useUpdateTripStatus } from '@/lib/queries/trips'
import { TRIP_STATUS_LABELS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS, groupsRequired } from '@/types/app'
import type { TripStatus, TripRole } from '@/types/app'
import TripOverviewTab from './tabs/TripOverviewTab'
import TripPlayersTab  from './tabs/TripPlayersTab'
import TripGroupsTab   from './tabs/TripGroupsTab'
import TripRoundsTab   from './tabs/TripRoundsTab'

export interface MemberProfile { id: string; full_name: string; avatar_url: string | null }
export interface TripMemberRow {
  id: string; role: string; profile_id: string; group_id?: string | null
  profiles: MemberProfile | null
}
export interface RoundRow {
  id: string; name: string; course_name: string | null; play_date: string
  tee_time: string | null; holes: number; scoring_format: string; status: string
}
export interface TripData {
  id: string; name: string; description: string | null; event_type: string | null
  location: string | null; start_date: string; end_date: string
  status: TripStatus; invite_code: string
  expected_players?: number; players_per_group?: number; organiser_is_playing?: boolean
  trip_members: TripMemberRow[]; rounds: RoundRow[]
}

interface Props { trip: TripData; currentUserId: string; userRole: TripRole }
type Tab = 'overview' | 'players' | 'groups' | 'rounds'

// Workflow progress steps — maps to demo's ProgressBar
const WORKFLOW: { key: TripStatus | 'setup'; label: string }[] = [
  { key: 'setup',        label: 'Setup' },
  { key: 'open',         label: 'Players' },
  { key: 'groups_ready', label: 'Groups' },
  { key: 'ready',        label: 'Ready' },
  { key: 'live',         label: 'Live' },
  { key: 'completed',    label: 'Done' },
]

function workflowStep(status: TripStatus): number {
  const map: Record<string, number> = {
    draft: 1, open: 2, groups_ready: 3, ready: 4, live: 5, completed: 6, archived: 6,
  }
  return map[status] ?? 1
}

export default function TripDetailClient({ trip, currentUserId, userRole }: Props) {
  const toast        = useToast()
  const router       = useRouter()
  const updateStatus = useUpdateTripStatus()
  const isOrganiser  = userRole === 'organiser'
  const [tab, setTab] = useState<Tab>('overview')

  const playerCount  = trip.trip_members.filter(m => m.role === 'player').length
  const numGroups    = groupsRequired(trip.expected_players, trip.players_per_group)
  const eventLabel   = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const step         = workflowStep(trip.status)

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'players',  label: 'Players', count: playerCount || undefined },
    { id: 'groups',   label: 'Groups' },
    { id: 'rounds',   label: 'Rounds', count: trip.rounds.length || undefined },
  ]

  // Edit trip URL — passes current values as prefill
  const editUrl = `/trips/new?editTripId=${trip.id}&prefill=${encodeURIComponent(JSON.stringify({
    details: {
      name: trip.name, event_type: trip.event_type ?? 'golf_trip',
      location: trip.location ?? '', start_date: trip.start_date, end_date: trip.end_date,
      description: trip.description ?? '', expected_players: trip.expected_players ?? 0,
      players_per_group: trip.players_per_group ?? 4,
      organiser_is_playing: trip.organiser_is_playing ?? false,
    },
    rounds: trip.rounds.map(r => ({
      id: r.id, name: r.name, course_name: r.course_name ?? '',
      play_date: r.play_date, tee_time: r.tee_time ?? '',
      holes: r.holes, scoring_format: r.scoring_format,
    })),
  }))}`

  return (
    /* Negative margin to break out of the padded layout container */
    <div className="-mx-4 -mt-5">

      {/* ── Demo TripOverviewScreen header ─────────────────────────────── */}
      {/* "background: linear-gradient(135deg, C.greenDeep 0%, C.green 60%, C.greenMid 100%)" */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 60%, #236040 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '12px 16px',
      }}>
        {/* Back link */}
        <a href="/dashboard" style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: 'rgba(245,230,184,0.55)', letterSpacing: 0.3,
          display: 'inline-block', marginBottom: 8,
        }}>← My Trips</a>

        <div style={{ height: 1, margin: '0 0 10px', background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

        {/* Trip identity — "ACTIVE TRIP" label + name + rounds badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)', color: '#d4b060', fontSize: 10.5,
              fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 3,
            }}>
              🌏 {trip.status === 'live' ? 'Live Trip' : TRIP_STATUS_LABELS[trip.status]}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)', color: '#ffffff',
              fontSize: 19, fontWeight: 700, letterSpacing: 0.2, marginBottom: 2,
            }}>
              {trip.name}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', color: '#f5e6b8', fontSize: 12 }}>
              {formatTripDateRange(trip.start_date, trip.end_date)}
              {trip.location ? ` · ${trip.location}` : ''}
              {trip.location ? '' : eventLabel !== 'Golf Trip' ? ` · ${eventLabel}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0, marginLeft: 12 }}>
            {/* Demo: rounds badge */}
            {trip.rounds.length > 0 && (
              <div style={{
                background: 'rgba(201,168,76,0.15)',
                border: '1.5px solid #c9a84c',
                borderRadius: 10, padding: '7px 13px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 22, fontWeight: 700 }}>
                  {trip.rounds.length}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', color: '#f5e6b8', fontSize: 9, letterSpacing: 0.7 }}>
                  ROUNDS
                </div>
              </div>
            )}
            {isOrganiser && (
              <a href={editUrl} style={{
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
                color: 'rgba(245,230,184,0.45)',
              }}>
                Edit trip
              </a>
            )}
          </div>
        </div>

        {/* Invite code strip — demo: dashed gold border box */}
        {isOrganiser && (
          <div style={{
            background: 'rgba(0,0,0,0.2)',
            border: '1px dashed rgba(201,168,76,0.45)',
            borderRadius: 8, padding: '8px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, marginBottom: 10,
          }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)',
                fontSize: 10.5, letterSpacing: 0.7, marginBottom: 2, textTransform: 'uppercase',
              }}>Trip Join Code</div>
              <div style={{
                fontFamily: 'var(--font-display)', color: '#e8c96a',
                fontSize: 21, fontWeight: 700, letterSpacing: 3.5,
              }}>{trip.invite_code}</div>
            </div>
            <button
              className="btn-press"
              onClick={async () => {
                const url = `${window.location.origin}/join/${trip.invite_code}`
                try { await navigator.clipboard.writeText(url); toast('Link copied!', 'success') }
                catch { toast('Could not copy', 'error') }
              }}
              style={{
                padding: '7px 13px',
                background: 'rgba(201,168,76,0.18)',
                border: '1px solid rgba(201,168,76,0.4)',
                borderRadius: 9,
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                color: '#e8c96a', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}>
              Copy &amp; Share
            </button>
          </div>
        )}

        <div style={{ height: 1, margin: '0 0 10px', background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)' }} />

        {/* Demo ProgressBar — gold gradient for completed steps */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 12 }}>
          {WORKFLOW.map((w, i) => (
            <div key={w.key} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i < step
                ? 'linear-gradient(90deg, #c9a84c, #e8c96a)'
                : i === step ? 'rgba(255,255,255,0.35)' : '#d9c9a3',
              boxShadow: i < step ? '0 0 6px rgba(201,168,76,0.45)' : 'none',
              transition: 'background 0.4s',
            }} />
          ))}
        </div>

        {/* Tab navigation */}
        <div style={{ display: 'flex', gap: 0, marginBottom: -2 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                fontFamily: 'var(--font-body)',
                fontSize: 11, fontWeight: 700,
                letterSpacing: 0.8, textTransform: 'uppercase',
                paddingBottom: 10, paddingTop: 4,
                borderBottom: `2px solid ${tab === t.id ? '#c9a84c' : 'transparent'}`,
                color: tab === t.id ? '#e8c96a' : 'rgba(245,230,184,0.4)',
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${tab === t.id ? '#c9a84c' : 'transparent'}`,
                cursor: 'pointer', transition: 'color 0.15s',
              } as React.CSSProperties}
            >
              {t.label}
              {t.count ? <span style={{ opacity: 0.6, marginLeft: 3 }}>({t.count})</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content — cream/ivory background ─────────────────────────── */}
      <div style={{ background: '#faf6ed', padding: '14px 16px 80px', minHeight: '60vh' }}>
        {tab === 'overview' && (
          <TripOverviewTab
            trip={trip} isOrganiser={isOrganiser}
            playerCount={playerCount} numGroups={numGroups}
            updateStatus={updateStatus} toast={toast} router={router}
            onTabChange={t => setTab(t)}
          />
        )}
        {tab === 'players' && (
          <TripPlayersTab
            trip={trip} currentUserId={currentUserId}
            isOrganiser={isOrganiser} onRefresh={() => router.refresh()}
          />
        )}
        {tab === 'groups' && (
          <TripGroupsTab
            trip={trip} isOrganiser={isOrganiser}
            onRefresh={() => router.refresh()}
          />
        )}
        {tab === 'rounds' && (
          <TripRoundsTab trip={trip} />
        )}
      </div>
    </div>
  )
}
