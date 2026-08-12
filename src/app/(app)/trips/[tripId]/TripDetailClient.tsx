'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatTripDateRange } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useUpdateTripStatus } from '@/lib/queries/trips'
import { TRIP_STATUS_LABELS, EVENT_TYPE_OPTIONS } from '@/types/app'
import { useQueryClient } from '@tanstack/react-query'
import { tripKeys } from '@/lib/queries/trips'
import type { TripStatus, TripRole } from '@/types/app'
import TripOverviewTab from './tabs/TripOverviewTab'
import TripPlayersTab  from './tabs/TripPlayersTab'
import TripGroupsTab   from './tabs/TripGroupsTab'
import PlayerHomeCard  from './PlayerHomeCard'
import TripRoundsTab   from './tabs/TripRoundsTab'

export interface MemberProfile { id: string; full_name: string; avatar_url: string | null; handicap?: number | null }
export interface TripMemberRow {
  id: string; role: string; profile_id: string; group_id?: string | null
  playing_handicap?: number | null
  profiles: MemberProfile | null
}
export interface RoundSideComp {
  id: string; comp_type: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay' | 'best_on_day' | 'custom'
  hole_number: number | null; enabled: boolean
}
export interface RoundRow {
  id: string; name: string; course_name: string | null; play_date: string
  tee_time: string | null; holes: number; scoring_format: string; status: string
  side_comps?: RoundSideComp[]
}
export interface TripData {
  id: string; name: string; description: string | null; event_type: string | null
  location: string | null; start_date: string; end_date: string
  status: TripStatus; invite_code: string
  expected_players?: number; players_per_group?: number; organiser_is_playing?: boolean
  trip_members: TripMemberRow[]; rounds: RoundRow[]; trip_groups?: Array<{ id: string; name?: string }>
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
  const isOrganiser  = userRole === 'organiser'

  // All hooks must run unconditionally, on every render, regardless of
  // role — the early return for players below happens AFTER every hook
  // call, never before, per React's Rules of Hooks.
  const toast        = useToast()
  const router       = useRouter()
  const updateStatus = useUpdateTripStatus()
  const [tab, setTab]            = useState<Tab>('overview')

  // Deep-link support: My HQ's "Go to Round N" CTA (and anywhere else
  // that wants to land directly on a tab) passes ?tab=rounds. Read once
  // on mount rather than as the initial state value — this keeps the
  // server-rendered and first-client-render output identical (both
  // start on 'overview', exactly as before), avoiding a hydration
  // mismatch, then switches tabs immediately after mount if requested.
  // Reuses the existing Tab state/switching mechanism; no new navigation
  // system.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    const valid: Tab[] = ['overview', 'players', 'groups', 'rounds']
    if (valid.includes(requested as Tab)) setTab(requested as Tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, [])
  const queryClient = useQueryClient()
  // Initialise from server-fetched trip data so Overview is correct before Groups tab is visited
  const [actualGroupCount, setActualGroupCount] = useState<number>(
    Array.isArray(trip.trip_groups) ? trip.trip_groups.length : 0
  )

  // Role-based experience (Sprint 5 — Player Experience Flow): a player
  // should never see the organiser setup workflow (Overview/Players/
  // Groups/Rounds tabs) — they get a streamlined status dashboard
  // instead. Placed after every hook call above (never before), so
  // nothing about hook order changes between an organiser's render and
  // a player's — only the JSX returned differs.
  if (!isOrganiser) {
    return <PlayerHomeCard trip={trip} currentUserId={currentUserId} />
  }

  const organiserIsPlaying = trip.organiser_is_playing ?? false
  const playerCount  = trip.trip_members.filter(m => m.role === 'player').length + (organiserIsPlaying ? 1 : 0)
  const numGroups    = actualGroupCount  // always use real count from DB
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
      status: r.status,
      // Corrected model: every enabled competition instance round-trips
      // into the wizard, including Powerplay (now just another comp_type
      // here, not a separate field) — a round with two NTPs correctly
      // carries both instances back into edit mode, not just one.
      side_comps: (r.side_comps ?? [])
        .filter((c): c is typeof c & { comp_type: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay'; hole_number: number } =>
          (c.comp_type === 'nearest_pin' || c.comp_type === 'longest_drive' || c.comp_type === 'pros_approach' || c.comp_type === 'powerplay')
          && c.enabled && c.hole_number != null)
        .map(c => ({ id: c.id, comp_type: c.comp_type, hole_number: c.hole_number })),
    })),
  }))}`

  return (
    /* Negative margin to break out of the padded layout container.
       pb-20 clears the fixed bottom nav on mobile; not needed on desktop,
       where that bar is hidden. */
    <div className="-mx-4 -mt-5 pb-20 md:pb-0">

      {/* ── Demo TripOverviewScreen header ─────────────────────────────── */}
      {/* "background: linear-gradient(135deg, C.greenDeep 0%, C.green 60%, C.greenMid 100%)" */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 60%, #236040 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '12px 16px',
      }}>
        {/* Back link */}
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: 'rgba(245,230,184,0.55)', letterSpacing: 0.3,
          display: 'inline-block', marginBottom: 8,
        }}>← My Trips</Link>

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
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
              <Link href={editUrl} style={{
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                color: 'rgba(245,230,184,0.7)', textDecoration: 'underline',
                textUnderlineOffset: 3, padding: '6px 4px', textAlign: 'center',
              }}>
                Edit trip
              </Link>
            )}
          </div>
        </div>

        {/* ── Invite players section ─────────────────────────────── */}
        {isOrganiser && (
          <div style={{ marginBottom: 14 }}>
            {/* Section heading — prominent */}
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontFamily: 'var(--font-display)', color: '#ffffff',
                fontSize: 17, fontWeight: 700, marginBottom: 3,
              }}>Invite players to this trip</div>
              <div style={{
                fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)',
                fontSize: 12, lineHeight: 1.4,
              }}>Share an invitation link or send the trip code so players can join.</div>
            </div>

            {/* PRIMARY ACTION — Invite via link */}
            <button
              className="btn-press"
              style={{
                width: '100%', padding: '14px 18px', marginBottom: 8,
                background: 'linear-gradient(135deg, #c9a84c 0%, #e8c96a 50%, #c9a84c 100%)',
                border: 'none', borderRadius: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: '0 4px 16px rgba(201,168,76,0.45)',
              }}
              onClick={async () => {
                const url = `${window.location.origin}/join/${trip.invite_code}`
                // Natural-language event-type phrasing for the invite
                // message specifically — deliberately not reusing
                // EVENT_TYPE_OPTIONS' labels ("Corporate Day") as-is,
                // since those read as UI chips, not as something you'd
                // say in a sentence ("corporate golf event" reads
                // naturally; "Corporate Day" doesn't). Falls back to the
                // universal "golf event" only when the type is null/
                // unmapped, per the explicit instruction — every other
                // real, known event_type gets its own real phrase.
                const eventPhrase: Record<string, string> = {
                  golf_trip: 'golf trip',
                  corporate_day: 'corporate golf event',
                  charity_day: 'charity golf day',
                  golf_society: 'golf day',
                  bucks_weekend: 'social round',
                }
                const phrase = (trip.event_type && eventPhrase[trip.event_type]) || 'golf event'
                const shareText = `You've been invited to ${trip.name} with Teein' It Up! ⛳\n\nJoin the ${phrase} using the link below:`
                const fullMessage = `${shareText}\n\n${url}`

                if (navigator.share) {
                  try { await navigator.share({ title: `Join ${trip.name}`, text: shareText, url }); toast('Shared!', 'success') }
                  catch { /* user cancelled */ }
                } else {
                  try { await navigator.clipboard.writeText(fullMessage); toast('Invitation copied — ready to share', 'success') }
                  catch { toast('Could not copy invitation', 'error') }
                }
              }}
            >
              <span style={{ fontSize: 16 }}>🔗</span>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 800,
                color: '#0f2d1c', letterSpacing: 0.3,
              }}>Invite via link</span>
            </button>
            <div style={{
              fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.4)',
              fontSize: 11, textAlign: 'center', marginTop: -4, marginBottom: 8,
            }}>Share a ready-made invitation through WhatsApp, text, email or your favourite app.</div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(201,168,76,0.2)' }} />
              <span style={{
                fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.35)',
                fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
              }}>Or share the join code</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(201,168,76,0.2)' }} />
            </div>

            {/* SECONDARY — Join code */}
            <div style={{
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(201,168,76,0.2)',
              borderRadius: 12, padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontFamily: 'var(--font-display)', color: '#e8c96a',
                  fontSize: 28, fontWeight: 800, letterSpacing: 5, lineHeight: 1,
                }}>{trip.invite_code}</div>
              </div>
              <button
                className="btn-press"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(trip.invite_code); toast('Join code copied', 'success') }
                  catch { toast('Could not copy code', 'error') }
                }}
                style={{
                  padding: '9px 16px',
                  background: 'rgba(201,168,76,0.12)',
                  border: '1.5px solid rgba(201,168,76,0.35)',
                  borderRadius: 9,
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                  color: '#e8c96a', cursor: 'pointer', flexShrink: 0,
                }}>
                Copy code
              </button>
            </div>
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
                border: 'none',
                borderBottom: `2px solid ${tab === t.id ? '#c9a84c' : 'transparent'}`,
                color: tab === t.id ? '#e8c96a' : 'rgba(245,230,184,0.4)',
                background: 'transparent',
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
            isOrganiser={isOrganiser} onRefresh={() => { router.refresh(); void queryClient.invalidateQueries({ queryKey: tripKeys.all }) }}
            onTabChange={(t) => setTab(t)}
          />
        )}
        {tab === 'groups' && (
          <TripGroupsTab
            trip={trip} isOrganiser={isOrganiser}
            onRefresh={() => { router.refresh(); void queryClient.invalidateQueries({ queryKey: tripKeys.all }) }}
            onTabChange={(t) => setTab(t)}
            onGroupsLoaded={(count) => setActualGroupCount(count)}
          />
        )}
        {tab === 'rounds' && (
          <TripRoundsTab trip={trip} isOrganiser={isOrganiser} onTabChange={(t) => setTab(t)} />
        )}
      </div>
    </div>
  )
}
