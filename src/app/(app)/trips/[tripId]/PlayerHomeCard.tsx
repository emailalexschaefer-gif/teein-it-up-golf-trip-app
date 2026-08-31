'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TripData, TripMemberRow } from './TripDetailClient'
import EventCountdown from '@/components/trips/EventCountdown'
import StartingGrid from '@/components/scoring/StartingGrid'
import PlayerCardModal, { initialsOf, type PlayerCardData } from '@/components/shared/PlayerCardModal'
import { resolveFocusRound } from '@/lib/scoring/multiRound'
import WelcomeBrochure, { CollapsedWelcomeCard, isBrochureDismissed } from '@/components/trips/WelcomeBrochure'
import InstallPwaCard from '@/components/trips/InstallPwaCard'
import { trackEvent } from '@/lib/analytics/trackEvent'
import { formatTripDateRange } from '@/lib/utils'
import TripInformationCard from '@/components/trips/TripInformationCard'

interface Props {
  trip: TripData
  currentUserId: string
}

function formatTeeTime(teeTime: string | null): string | null {
  if (!teeTime) return null
  // tee_time is typically stored as HH:MM(:SS); render as a friendly 12h time.
  const [hStr, mStr] = teeTime.split(':')
  const h = Number(hStr)
  if (Number.isNaN(h)) return teeTime
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mStr} ${period}`
}

function formatLabel(format: string): string {
  return format.charAt(0).toUpperCase() + format.slice(1).replace(/_/g, ' ')
}

/**
 * Players Joined — social proof on the waiting-for-organiser screen.
 * Deliberately reads trip.trip_members directly (the exact same prop
 * TripDetailClient already passes down, and the exact same canonical
 * data the organiser Players tab and My Events count are being fixed to
 * use below) — no separate fetch, no separate source of truth to drift
 * out of sync with those two. Read-only by construction: this component
 * has no button, form, or mutation anywhere in it, for any role — the
 * "read-only for normal players, no remove/edit controls" requirement
 * isn't a permission check to get right, there's simply nothing here
 * that could edit anything regardless of who's viewing it.
 */
/**
 * Deployment/bug fix — the count on this screen and the dashboard's
 * event tile both correctly showed "2", but the roster itself only
 * rendered one card. Root cause: this component previously read
 * trip.trip_members directly — the RLS-subject server-rendered prop
 * from page.tsx, fetched once via a query nested through trips and
 * further through profiles. A far simpler, separately-computed COUNT
 * (this component's own formula, and the dashboard's) apparently
 * resolved correctly under the RLS policy in its current production
 * state, while this specific nested-query shape did not reliably
 * surface every member's row — only the viewing player's own row was
 * guaranteed visible. See migration 054 for the suspected underlying
 * RLS cause (a likely-unapplied recursion fix from migration 008).
 *
 * Fix: poll /api/trips/[tripId]/members — the exact same admin-backed,
 * RLS-bypassing endpoint TripDetailClient.tsx already uses for the
 * organiser Players/Overview/Groups tabs (added in an earlier pass).
 * This is now the one canonical source for all three surfaces
 * (dashboard tile still uses its own query — see accompanying fix in
 * src/lib/queries/trips.ts — but this screen and the organiser tabs now
 * genuinely share the same data path, not just the same shape). Falls
 * back to the server-rendered trip.trip_members prop only until the
 * first poll resolves, so there's no loading flash to an empty roster.
 */
function PlayersJoinedSection({ trip, onSelectPlayer }: { trip: TripData; onSelectPlayer: (m: TripMemberRow) => void }) {
  const [showAll, setShowAll] = useState(false)
  const [liveMembers, setLiveMembers] = useState<TripMemberRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${trip.id}/members`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body?.members) setLiveMembers(body.members) })
      .catch(() => { /* stays on the prop-based fallback below rather than showing an error for a read-only social widget */ })
    return () => { cancelled = true }
  }, [trip.id])

  const roster = liveMembers ?? trip.trip_members
  // Same canonical formula as TripDetailClient.tsx and the dashboard's
  // player_count — role='player' members, plus the organiser only if
  // organiser_is_playing. The roster below still shows every joined
  // member (organiser included, as a person) — only this heading number
  // is the narrower, canonical "players" count.
  const playerCount = roster.filter(m => m.role === 'player').length + (trip.organiser_is_playing ? 1 : 0)
  const visible = showAll ? roster : roster.slice(0, 8)

  if (roster.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Players Joined ({playerCount})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(m => (
          <button
            key={m.profile_id}
            onClick={() => onSelectPlayer(m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', border: '1px solid #eceae3',
              borderRadius: 10, padding: '7px 10px', width: '100%', textAlign: 'left', cursor: 'pointer',
            }}
          >
            {m.profiles?.avatar_url ? (
              <img src={m.profiles.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11,
              }}>
                {initialsOf(m.profiles?.full_name ?? '?')}
              </div>
            )}
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.profiles?.full_name ?? 'Player'}
            </span>
            {m.profiles?.handicap != null && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', fontWeight: 700, flexShrink: 0 }}>
                HCP {m.profiles.handicap}
              </span>
            )}
          </button>
        ))}
      </div>
      {roster.length > 8 && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            display: 'block', width: '100%', marginTop: 8, padding: '8px 0', background: 'none',
            border: 'none', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#a1791f', cursor: 'pointer',
          }}
        >
          {showAll ? 'Show less' : `View all ${roster.length} players`}
        </button>
      )}
    </div>
  )
}

/**
 * Player card modal — regression fix: previously defined locally here.
 * The Field and Live Leaderboard needed the exact same modal to
 * restore their own lost tap-to-profile behaviour, and "do not create
 * another profile component" meant extracting the one that already
 * existed (src/components/shared/PlayerCardModal.tsx) rather than each
 * surface growing its own copy. Imported below — nothing about the
 * modal's fields, layout, or mobile handling changed, only which file
 * owns it.
 */

/**
 * Event Lobby delta — the read-only player Trip Information view.
 * Reuses TripInformationCard directly with isOrganiser={false} (that
 * component already internally gates its own edit controls on that
 * prop — nothing new to build for the "read-only, no organiser edit"
 * requirement, just pass the right value). Rounds are rendered from
 * trip.rounds, already present on the same TripData this whole page
 * already has — no new fetch, no schema change. Deliberately shows only
 * name/course/date/tee-time/format per round — no Begin Round, no Edit
 * holes, no organiser-only action of any kind, since none of those
 * controls exist anywhere in this component to begin with (unlike
 * TripOverviewTab, which this deliberately does NOT reuse wholesale,
 * since that component has organiser actions woven throughout it that
 * would need extensive gating to reuse safely here).
 */
function PlayerEventInfoView({ trip, onBack }: { trip: TripData; onBack: () => void }) {
  return (
    <div className="-mx-4 -mt-5 pb-20 md:pb-0">
      <div style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 60%, #236040 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '20px 16px 24px',
      }}>
        <button
          onClick={onBack}
          style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
            color: 'rgba(245,230,184,0.55)', letterSpacing: 0.3,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10,
          }}
        >
          ← Back to Event Lobby
        </button>
        <div style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, letterSpacing: -0.3 }}>
          {trip.name}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13, marginTop: 4 }}>
          {formatTripDateRange(trip.start_date, trip.end_date)}
          {trip.location ? ` · 📍 ${trip.location}` : ''}
        </div>
      </div>

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {trip.description && (
          <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #eceae3', padding: 16 }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>About</p>
            {/* Same pre-wrap treatment as the just-fixed organiser About
                field — the same organiser-entered text, same formatting
                bug would otherwise apply here too. */}
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#1a1a16', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
              {trip.description}
            </p>
          </div>
        )}

        <TripInformationCard tripId={trip.id} isOrganiser={false} />

        {trip.rounds.length > 0 && (
          <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #eceae3', padding: 16 }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Rounds</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date)).map(r => (
                <div key={r.id} style={{ borderBottom: '1px solid #f3f1ea', paddingBottom: 10 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d' }}>{r.name}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginTop: 2 }}>
                    {r.course_name ?? 'Course TBC'} · {new Date(r.play_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {r.tee_time ? ` · ${formatTeeTime(r.tee_time)}` : ''} · {formatLabel(r.scoring_format)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlayerHomeCard({ trip, currentUserId }: Props) {
  // Event Lobby <-> Trip Information toggle — local state, not a route
  // change, per explicit instruction ("should not require leaving the
  // event or using browser back"). Named generically (view/EventInfo,
  // not "waitingRoomView"/"TripInfoOnly") since the brief also asks not
  // to tightly couple this new structure to the word "Trip" any more
  // than the already-existing codebase does — the visible label stays
  // "Trip Information" for now, per instruction, only the internal
  // naming here is kept neutral where it costs nothing to do so.
  const [view, setView] = useState<'lobby' | 'eventInfo'>('lobby')
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCardData | null>(null)
  const router = useRouter()

  // Item F — "brief positive confirmation." Read once on mount via
  // window.location.search directly (not useSearchParams(), which
  // requires a Suspense boundary this component tree doesn't have) —
  // simplest safe way to read a one-time query param outside App
  // Router's search-params machinery. router.replace strips it from the
  // URL immediately after showing it, so refreshing or sharing the URL
  // never repeats the confirmation or leaves it stuck in browser history.
  const [justJoined, setJustJoined] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('joined') === '1') {
      setJustJoined(true)
      router.replace(`/trips/${trip.id}`)
      const t = setTimeout(() => setJustJoined(false), 4000)
      return () => clearTimeout(t)
    }
  }, [trip.id, router])

  // GA4 / Product Analytics brief — core player funnel. Fires once per
  // mount, not on every render — this is "the player reached the
  // Lobby," a meaningful funnel step, not something that should fire
  // repeatedly as the component re-renders for unrelated reasons.
  // tripId is an opaque internal identifier, not PII.
  useEffect(() => {
    trackEvent('lobby_opened', { tripId: trip.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

  const me = trip.trip_members.find(m => m.profile_id === currentUserId)
  // Item 4 — real organiser name, not hardcoded. trip.trip_members is
  // already fetched and available here; no new query needed.
  const organiserName = trip.trip_members.find(m => m.role === 'organiser')?.profiles?.full_name ?? null
  const [brochureExpanded, setBrochureExpanded] = useState(() => !isBrochureDismissed(trip.id))
  const myGroup = me?.group_id ? trip.trip_groups?.find(g => g.id === me.group_id) : undefined

  // Focus on the most relevant round: the active one if there is one,
  // otherwise the earliest upcoming one, otherwise the most recently
  // completed one — always exactly one round's status to act on, not a
  // list of tabs to interpret.
  const rounds = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))
  const activeRound = rounds.find(r => r.status === 'active')
  const upcomingRound = rounds.find(r => r.status === 'upcoming')
  const completedRounds = rounds.filter(r => r.status === 'completed')
  const focusRound = resolveFocusRound(activeRound, completedRounds[completedRounds.length - 1], upcomingRound)

  if (view === 'eventInfo') {
    return <PlayerEventInfoView trip={trip} onBack={() => setView('lobby')} />
  }

  return (
    <div className="-mx-4 -mt-5 pb-20 md:pb-0">
      {justJoined && (
        <div style={{
          background: '#166534', color: '#fff', textAlign: 'center', padding: '10px 16px',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,
        }}>
          ✓ You&apos;ve joined {trip.name}
        </div>
      )}
      <div style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 60%, #236040 100%)',
        borderBottom: '2px solid #c9a84c',
        padding: '20px 16px 24px',
      }}>
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: 'rgba(245,230,184,0.55)', letterSpacing: 0.3,
          display: 'inline-block', marginBottom: 10,
        }}>← My Events</Link>

        <div style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, letterSpacing: -0.3 }}>
          {trip.name}
        </div>
        {trip.location && (
          <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13, marginTop: 4 }}>
            📍 {trip.location}
          </div>
        )}
        {/* Event Lobby countdown — round-aware fix: previously hardcoded
            to rounds[0] (literally Round 1, forever), so once Round 1
            completed the countdown simply vanished rather than
            retargeting to Round 2. focusRound (computed above —
            activeRound ?? upcomingRound ?? most-recent-completed) is the
            exact "next relevant round" logic this screen already uses
            for its own status card below; reusing it here means the
            countdown now naturally follows the trip's actual progress
            through multiple rounds. EventCountdown itself is untouched
            — still the same single engine, still internally hiding
            itself whenever the target round isn't 'upcoming' (which
            correctly covers the "after the final round, no more
            countdown" case too, since focusRound then resolves to a
            completed round). */}
        {focusRound && <EventCountdown tripId={trip.id} round={focusRound} />}
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        {/* Item 1/9 — Welcome Brochure, placed directly beneath the
            event header/countdown and above the existing Lobby status.
            Watermark image supplied for this feature; the strong dark
            green gradient (inside WelcomeBrochure itself) keeps text
            fully legible while the photography stays subtly visible
            behind it.
            30 Aug field-test bundle — player lobby / smart PWA
            install. The install promotion now renders INSIDE
            WelcomeBrochure itself (near its own top, see that
            component) when expanded — genuinely part of the premium
            onboarding card, not a separate banner bolted above it. If
            the player has already collapsed the welcome text (a
            separate, independent dismissal from installing the app),
            it renders here instead, alongside the collapsed summary —
            dismissing "welcome" must never also silently hide the
            install prompt; InstallPwaCard still fully owns its own
            visibility either way (installed/dismissed/etc. all return
            null internally), so this never renders twice regardless of
            which branch is active. */}
        {brochureExpanded ? (
          <WelcomeBrochure
            tripId={trip.id} tripName={trip.name}
            watermarkUrl="/brand/lobby-brochure-watermark.png"
            onDismiss={() => setBrochureExpanded(false)}
          />
        ) : (
          <>
            <InstallPwaCard />
            <CollapsedWelcomeCard onReopen={() => setBrochureExpanded(true)} />
          </>
        )}

        {/* Item 1 — the explicit "Event Lobby" reframing. Previously
            this label only existed in the back-link text ("← Back to
            Event Lobby") from the Trip Information view — the main
            screen itself had no heading of its own, only the trip
            name/location above. Shown regardless of round status
            (upcoming/active/completed) since this remains the player's
            general home base for the whole event, not just the pre-
            Round-1 wait — Trip Information/Join the Chat/Players Joined
            stay relevant throughout, not only before the first round. */}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
          Event Lobby
        </p>

        {/* Status card — everything a player needs to know at a glance,
            nothing they need to configure. */}
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #eceae3', boxShadow: '0 4px 18px rgba(0,0,0,0.08)', padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>✅</span>
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#16a34a' }}>Joined</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {myGroup && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d' }}>
                <span>👥</span><span>{myGroup.name}</span>
              </div>
            )}
            {focusRound?.tee_time && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#14532d' }}>
                <span>⏰</span><span>Tee time {formatTeeTime(focusRound.tee_time)}</span>
              </div>
            )}
          </div>

          {/* Round status / primary action — the one thing a player
              actually needs to do or know right now. Event-complete
              takes priority over "this round is complete" — trip.status
              is the authoritative signal (set automatically, once, when
              the last round closes — see close/route.ts), not derived
              from focusRound alone, since focusRound would say the same
              "complete" thing for an in-between round too. */}
          {trip.status === 'completed' ? (
            <Link
              href={`/trips/${trip.id}/results`}
              style={{
                display: 'block', textAlign: 'center', padding: 16, borderRadius: 12,
                background: 'linear-gradient(135deg,#14532d,#1a6b3a)', color: '#fff',
                fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 15, textDecoration: 'none',
                boxShadow: '0 4px 16px rgba(20,83,45,0.3)',
              }}
            >
              🏆 View Final Results
            </Link>
          ) : (
            <>
              {!focusRound && (
                <div style={{ textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>
                  The organiser hasn&apos;t set up a round yet.
                </div>
              )}
              {focusRound?.status === 'upcoming' && (
                <div style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#a1791f' }}>
                    🟡 Waiting for {organiserName ?? 'the organiser'} to start {focusRound.name}
                  </span>
                </div>
              )}

              {/* Event Lobby delta — Trip Information + Join the Chat,
                  in the exact required order, both directly below the
                  waiting card and above the player roster. Trip
                  Information switches this same Home screen into a
                  local read-only view (no navigation) rather than
                  routing anywhere; Join the Chat is an ordinary Link
                  into the existing chat route, unchanged in mechanism
                  from the already-completed waiting-room package — only
                  its position moved, from below the roster to here. */}
              <button
                onClick={() => setView('eventInfo')}
                style={{
                  display: 'block', width: '100%', marginTop: 10, padding: '12px 14px', borderRadius: 12,
                  background: '#ffffff', border: '1.5px solid #d1d5db', textAlign: 'left', cursor: 'pointer',
                }}
              >
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, color: '#14532d' }}>📋 Trip Information →</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
                  Rounds, courses, itinerary &amp; event details
                </div>
              </button>

              <Link
                href={`/trips/${trip.id}/chat`}
                style={{
                  display: 'block', marginTop: 10, padding: '12px 14px', borderRadius: 12,
                  background: 'linear-gradient(135deg,#14532d,#1a6b3a)', textDecoration: 'none', textAlign: 'center',
                  boxShadow: '0 4px 14px rgba(20,83,45,0.25)',
                }}
              >
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, color: '#fff' }}>💬 Join the Chat →</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
                  Meet the crew and start the banter
                </div>
              </Link>

              {/* Starting Grid — Deployment 1's core "don't expose
                  organiser drafts" gate. groups_released is the single
                  source of truth (migration 058); this reads it purely
                  as presentation, not a second permission check —
                  RLS/API access to group membership is unchanged, this
                  only decides which of two already-correct views to
                  render. focusRound must exist too, since a Starting
                  Grid without a specific round to attach tee times/
                  starting holes to wouldn't mean anything yet. */}
              {/* Package 2 — gates on this specific round's own
                  setup_released, not the trip-wide trips.groups_released.
                  A trip can have Round 1 live/complete while Round 2 is
                  still mid-preparation; the trip-wide flag couldn't
                  represent that. trips.groups_released itself is left
                  untouched elsewhere (not removed), since this is the
                  narrower, more correct signal for this specific gate. */}
              {focusRound?.setup_released && trip.trip_groups && trip.trip_groups.length > 0 ? (
                <StartingGrid
                  tripId={trip.id} roundId={focusRound.id} groups={trip.trip_groups}
                  onSelectPlayer={m => setSelectedPlayer(m)}
                />
              ) : (
                <PlayersJoinedSection trip={trip} onSelectPlayer={m => setSelectedPlayer(m)} />
              )}
              {focusRound?.status === 'active' && (
                <Link
                  href={`/trips/${trip.id}/rounds/${focusRound.id}`}
                  style={{
                    display: 'block', textAlign: 'center', padding: 16, borderRadius: 12,
                    background: 'linear-gradient(135deg,#2d7a52,#16a34a)', color: '#fff',
                    fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 16, textDecoration: 'none',
                    boxShadow: '0 4px 16px rgba(22,163,74,0.3)',
                  }}
                >
                  ▶ Start Scoring
                </Link>
              )}
              {focusRound?.status === 'completed' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
                    ✓ {focusRound.name} complete
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* The only two destinations a player needs beyond the bottom
            nav's own Leaderboard/Side Games/Chat/Scorecard — no Players/
            Groups/Rounds tabs, no setup tools. */}
        <Link href={`/trips/${trip.id}/leaderboard`} style={{
          display: 'block', textAlign: 'center', padding: 13, borderRadius: 10,
          background: '#ffffff', border: '1.5px solid #d1d5db', marginBottom: 8,
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', textDecoration: 'none',
        }}>
          View Leaderboard
        </Link>
      </div>

      {selectedPlayer && <PlayerCardModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </div>
  )
}
