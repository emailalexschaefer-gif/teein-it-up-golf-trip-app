'use client'

import { useRouter } from 'next/navigation'
import { Card, SectionHeader, Badge, EmptyState } from '@/components/ui/Layout'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useUpdateTripStatus } from '@/lib/queries/trips'
import { cn, formatTripDateRange, formatTripDate, initials } from '@/lib/utils'
import { getAppUrl } from '@/lib/utils'
import {
  TRIP_STATUS_LABELS, TRIP_STATUS_COLORS, TRIP_STATUS_TRANSITIONS, EVENT_TYPE_OPTIONS,
} from '@/types/app'
import type { TripStatus, TripRole } from '@/types/app'

interface MemberProfile { id: string; full_name: string; avatar_url: string | null }
interface TripMemberRow { id: string; role: string; profile_id: string; profiles: MemberProfile | null }
interface RoundRow {
  id: string; name: string; course_name: string | null; play_date: string
  tee_time: string | null; holes: number; scoring_format: string; status: string
}
interface TripData {
  id: string; name: string; description: string | null; event_type: string | null
  location: string | null; start_date: string; end_date: string
  status: TripStatus; invite_code: string
  trip_members: TripMemberRow[]; rounds: RoundRow[]
}

interface Props { trip: TripData; currentUserId: string; userRole: TripRole }

export default function TripDetailClient({ trip, currentUserId, userRole }: Props) {
  const toast       = useToast()
  const router      = useRouter()
  const updateStatus = useUpdateTripStatus()
  const isOrganiser  = userRole === 'organiser'

  const inviteUrl  = `${typeof window !== 'undefined' ? getAppUrl() : ''}/join/${trip.invite_code}`
  const eventLabel = EVENT_TYPE_OPTIONS.find((o) => o.value === trip.event_type)?.label ?? trip.event_type ?? 'Golf Trip'

  const organiserRow = trip.trip_members.find((m) => m.role === 'organiser')
  const players      = trip.trip_members.filter((m) => m.role === 'player')

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast('Invite link copied!', 'success')
    } catch {
      toast('Copy failed — select the link manually', 'error')
    }
  }

  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <a href="/dashboard" className="inline-flex items-center text-sm text-text-muted hover:text-brand-600 transition-colors mb-2">
          ← My Trips
        </a>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">{trip.name}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {formatTripDateRange(trip.start_date, trip.end_date)}
              {trip.location ? ` · ${trip.location}` : ''}
            </p>
          </div>
          <Badge className={cn('flex-shrink-0 mt-1', TRIP_STATUS_COLORS[trip.status])}>
            {TRIP_STATUS_LABELS[trip.status]}
          </Badge>
        </div>
      </div>

      {/* Overview */}
      <Card>
        <SectionHeader title="Overview" />
        <div className="space-y-2">
          <InfoRow label="Type"  value={eventLabel} />
          <InfoRow label="Dates" value={formatTripDateRange(trip.start_date, trip.end_date)} />
          {trip.location && <InfoRow label="Location" value={trip.location} />}
          {trip.description && (
            <div className="pt-1">
              <p className="text-xs text-text-muted mb-1">About</p>
              <p className="text-sm text-text">{trip.description}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Schedule */}
      <div>
        <SectionHeader
          title="Schedule"
          subtitle={`${trip.rounds.length} round${trip.rounds.length !== 1 ? 's' : ''}`}
        />
        {trip.rounds.length === 0 ? (
          <EmptyState title="No rounds yet" />
        ) : (
          <div className="space-y-2">
            {trip.rounds.map((round, i) => (
              <Card key={round.id} padding="sm">
                <div className="flex items-center gap-3 px-1">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-brand-600">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-text truncate">{round.name}</p>
                    <p className="text-xs text-text-muted">
                      {round.course_name ? `${round.course_name} · ` : ''}
                      {formatTripDate(round.play_date)}
                      {round.tee_time ? ` · ${round.tee_time}` : ''}
                      {' · '}{round.holes} holes
                    </p>
                  </div>
                  <RoundBadge status={round.status} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Members */}
      <div>
        <SectionHeader
          title="Members"
          subtitle={`${trip.trip_members.length} member${trip.trip_members.length !== 1 ? 's' : ''}`}
        />
        <Card>
          <div className="space-y-3">
            {organiserRow?.profiles && (
              <MemberRow profile={organiserRow.profiles} role="organiser" isYou={organiserRow.profile_id === currentUserId} />
            )}
            {players.map((m) =>
              m.profiles ? (
                <MemberRow key={m.id} profile={m.profiles} role="player" isYou={m.profile_id === currentUserId} />
              ) : null
            )}
            {players.length === 0 && (
              <p className="text-sm text-text-muted text-center py-2">
                No players yet — share the invite link to get started.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Invite — organiser only */}
      {isOrganiser && (
        <div>
          <SectionHeader title="Invite players" />
          <Card>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-text-muted mb-1">Invite code</p>
                <p className="text-2xl font-bold tracking-widest text-brand-600 font-mono">{trip.invite_code}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Invite link</p>
                <div className="bg-surface-muted rounded-xl px-3 py-2">
                  <p className="text-xs text-text font-mono truncate">{inviteUrl}</p>
                </div>
              </div>
              <Button fullWidth onClick={handleCopyInvite}>Copy invite link</Button>
              <p className="text-xs text-text-subtle text-center">
                Players tap the link, enter their name and email, and join instantly.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Status controls — organiser only */}
      {isOrganiser && nextStatuses.length > 0 && (
        <div>
          <SectionHeader title="Trip status" />
          <Card>
            <p className="text-sm text-text-muted mb-3">
              Current: <strong className="text-text">{TRIP_STATUS_LABELS[trip.status]}</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map((s) => (
                <Button
                  key={s}
                  variant="secondary"
                  size="sm"
                  loading={updateStatus.isPending}
                  onClick={async () => {
                    await updateStatus.mutateAsync({ tripId: trip.id, status: s })
                    toast(`Marked as ${TRIP_STATUS_LABELS[s]}`, 'success')
                    router.refresh()
                  }}
                >
                  Mark as {TRIP_STATUS_LABELS[s]}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Coming soon */}
      <div>
        <SectionHeader title="Coming soon" />
        <div className="space-y-2">
          {[
            { icon: '⛳', label: 'Live Scoring',      desc: 'Hole-by-hole scoring' },
            { icon: '🏆', label: 'Leaderboards',      desc: 'Live Stableford standings' },
            { icon: '🎯', label: 'Side Competitions', desc: 'Nearest pin, longest drive & more' },
          ].map((item) => (
            <div key={item.label} className="bg-surface-subtle rounded-2xl p-4 flex items-center gap-3 opacity-50">
              <span className="text-xl">{item.icon}</span>
              <div>
                <p className="font-semibold text-sm text-text">{item.label}</p>
                <p className="text-xs text-text-muted">{item.desc}</p>
              </div>
              <span className="ml-auto text-xs text-text-subtle bg-white px-2 py-1 rounded-lg">Sprint 3</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-text-muted w-20 flex-shrink-0 text-xs">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}

function MemberRow({ profile, role, isYou }: { profile: MemberProfile; role: string; isYou: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt={profile.full_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-brand-600">{initials(profile.full_name || '?')}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">
          {profile.full_name || 'Player'}
          {isYou && <span className="text-text-subtle text-xs ml-1">(you)</span>}
        </p>
        <p className="text-xs text-text-muted capitalize">{role}</p>
      </div>
    </div>
  )
}

function RoundBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming:  'bg-surface-subtle text-text-muted',
    active:    'bg-green-50 text-green-700',
    completed: 'bg-brand-50 text-brand-600',
  }
  const labels: Record<string, string> = { upcoming: 'Upcoming', active: 'Live', completed: 'Done' }
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', map[status] ?? map.upcoming)}>
      {labels[status] ?? status}
    </span>
  )
}
