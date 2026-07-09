'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn, formatTripDateRange, formatTripDate, initials } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useUpdateTripStatus } from '@/lib/queries/trips'
import {
  TRIP_STATUS_LABELS, TRIP_STATUS_COLORS, TRIP_STATUS_TRANSITIONS,
  EVENT_TYPE_OPTIONS, groupsRequired,
} from '@/types/app'
import type { TripStatus, TripRole } from '@/types/app'
import TripOverviewTab from './tabs/TripOverviewTab'
import TripPlayersTab  from './tabs/TripPlayersTab'
import TripGroupsTab   from './tabs/TripGroupsTab'
import TripRoundsTab   from './tabs/TripRoundsTab'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  expected_players: number; players_per_group: number
  trip_members: TripMemberRow[]; rounds: RoundRow[]
}

interface Props { trip: TripData; currentUserId: string; userRole: TripRole }

type Tab = 'overview' | 'players' | 'groups' | 'rounds'

// ── Component ─────────────────────────────────────────────────────────────────

export default function TripDetailClient({ trip, currentUserId, userRole }: Props) {
  const toast        = useToast()
  const router       = useRouter()
  const updateStatus = useUpdateTripStatus()
  const isOrganiser  = userRole === 'organiser'
  const [tab, setTab] = useState<Tab>('overview')

  const players      = trip.trip_members.filter((m) => m.role !== 'organiser' || trip.trip_members.length === 1)
  const playerCount  = trip.trip_members.filter(m => m.role === 'player').length
  const numGroups    = groupsRequired(trip.expected_players, trip.players_per_group)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'players',  label: `Players${playerCount ? ` (${playerCount})` : ''}` },
    { id: 'groups',   label: 'Groups' },
    { id: 'rounds',   label: `Rounds${trip.rounds.length ? ` (${trip.rounds.length})` : ''}` },
  ]

  return (
    <div className="space-y-0">
      {/* ── Trip header ────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <a href="/dashboard" className="inline-flex items-center text-sm text-text-muted hover:text-brand-600 transition-colors mb-2">
          ← My Trips
        </a>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text leading-tight">{trip.name}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {formatTripDateRange(trip.start_date, trip.end_date)}
              {trip.location ? ` · ${trip.location}` : ''}
            </p>
          </div>
          <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 mt-1', TRIP_STATUS_COLORS[trip.status])}>
            {TRIP_STATUS_LABELS[trip.status]}
          </span>
        </div>
      </div>

      {/* ── Tab navigation ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-surface-subtle mb-5 -mx-4 px-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'text-sm font-medium pb-2.5 px-1 border-b-2 whitespace-nowrap transition-colors',
              tab === t.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-text-muted hover:text-text'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <TripOverviewTab
          trip={trip}
          isOrganiser={isOrganiser}
          playerCount={playerCount}
          numGroups={numGroups}
          updateStatus={updateStatus}
          toast={toast}
          router={router}
        />
      )}
      {tab === 'players' && (
        <TripPlayersTab
          trip={trip}
          currentUserId={currentUserId}
          isOrganiser={isOrganiser}
          onRefresh={() => router.refresh()}
        />
      )}
      {tab === 'groups' && (
        <TripGroupsTab
          trip={trip}
          isOrganiser={isOrganiser}
          onRefresh={() => router.refresh()}
        />
      )}
      {tab === 'rounds' && (
        <TripRoundsTab trip={trip} />
      )}
    </div>
  )
}
