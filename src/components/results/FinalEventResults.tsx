'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import ConfettiBurst from './ConfettiBurst'

interface RoundRef { roundId: string; roundNumber: number; roundName: string; courseName: string | null }
interface StandingRound { roundId: string; roundNumber: number; points: number }
interface Standing { playerId: string; playerName: string; totalPoints: number; position: number; roundsPlayed: number; rounds: StandingRound[] }
interface RoundWinner { roundId: string; roundNumber: number; roundName: string; courseName: string | null; winners: { playerId: string; playerName: string; points: number }[] }
interface Champion { playerId: string; playerName: string; totalPoints: number }
interface SideCompWinner { playerId: string; playerName: string; resultValue: number | null; momentId: string | null }
interface RoundSideCompetitions {
  roundId: string; roundNumber: number; roundName: string; courseName: string | null
  competitions: {
    compType: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay'; holeNumber: number | null
    winner: SideCompWinner | null
    // Only meaningful for compType === 'powerplay' — a per-instance
    // best-score highlight, not a submitted leader. Two Powerplay holes
    // in one round each get their own competitions[] entry here, never
    // merged into a single round-level field.
    powerplayBest: { playerId: string; playerName: string; points: number } | null
  }[]
}
// Release 2, item 5 — mirrors EventHighlight from eventMakersBreakers.ts.
// A local type here, not an import, since this is a client component
// consuming an API response shape, not the server module itself.
interface EventHighlight {
  category: string
  kind: 'maker' | 'breaker'
  scope: 'individual' | 'group'
  title: string
  definition?: string
  playerIds: string[]
  playerNames: string[]
  groupId?: string | null
  groupName?: string | null
  roundId?: string | null
  roundNumber?: number | null
  holeNumber?: number | null
  statValue: number
  statLine: string
  significance: number
}

interface FinalResults {
  tripName: string
  rounds: RoundRef[]
  standings: Standing[]
  roundWinners: RoundWinner[]
  champions: Champion[]
  hasTie: boolean
  sideCompetitionsByRound: RoundSideCompetitions[]
  eventHighlights: { makers: EventHighlight[]; breakers: EventHighlight[] }
}

// Release 2, item 5 — the same icon-by-category convention the
// round-level slideshow uses per archetype; event-level categories are
// their own distinct set (see eventMakersBreakers.ts), so this is a
// small local lookup rather than importing the round-level one, which
// doesn't have entries for these keys at all.
const EVENT_HIGHLIGHT_ICON: Record<string, string> = {
  event_champion: '🏆', most_points: '🥇', most_birdies: '🐦', most_pars: '🎯',
  best_single_round: '⭐', biggest_improver: '📈', best_group: '🤝',
  most_wipes: '💥', most_double_bogeys: '📉', toughest_hole_victim: '😬',
  biggest_decline: '❄️', worst_group_stretch: '🥶',
}

function EventHighlightCard({ h }: { h: EventHighlight }) {
  const names = h.scope === 'group' ? (h.groupName ?? 'Group') : h.playerNames.join(' & ')
  return (
    <div style={{
      background: h.kind === 'maker' ? 'linear-gradient(135deg,#14532d,#1a6b3a)' : 'linear-gradient(135deg,#3a1a1a,#5c2626)',
      borderRadius: 16, padding: '22px 18px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: h.kind === 'maker' ? '#e8c96a' : '#f0a8a8' }}>
        {h.kind === 'maker' ? '🔥 Maker' : '💥 Breaker'}
      </div>
      <div style={{ fontSize: 32, margin: '10px 0 4px' }}>{EVENT_HIGHLIGHT_ICON[h.category] ?? (h.kind === 'maker' ? '🏆' : '💢')}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: 0.3 }}>
        {h.title.toUpperCase()}
      </div>
      {h.definition && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 6, lineHeight: 1.4 }}>
          {h.definition}
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#e8c96a', marginTop: 10 }}>
        {names || '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4 }}>
        {h.statLine}
      </div>
    </div>
  )
}

const SIDE_COMP_LABELS: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
  powerplay:     { icon: '⚡', label: 'Powerplay Highlight' },
}

export default function FinalEventResults({ tripId }: { tripId: string }) {
  const { data, isLoading, error } = useQuery<FinalResults>({
    queryKey: ['final-results', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/final-results`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load final results.')
      return body
    },
    staleTime: 60000, // final and locked — this doesn't need live polling like an active leaderboard does
  })

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Loading final results…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Final Results</span>
        </div>
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', padding: '28px 16px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 13.5, lineHeight: 1.6 }}>
            {error instanceof Error ? error.message : "This event's final results aren't available yet."}
          </p>
        </div>
      </div>
    )
  }

  // Podium: group by distinct position value, not array index — a tie at
  // position 1 (two players) still occupies only the gold tier; the next
  // distinct position (3, under standard 1,2,2,4 ranking, never 2) is
  // silver. Never picks a single name out of a tied group.
  const positionGroups = Array.from(new Set(data.standings.map(s => s.position))).sort((a, b) => a - b).slice(0, 3)
  const podium = positionGroups.map(pos => ({ position: pos, players: data.standings.filter(s => s.position === pos) }))
  const medal = (pos: number) => pos === positionGroups[0] ? '🥇' : pos === positionGroups[1] ? '🥈' : '🥉'

  const championNames = data.champions.map(c => c.playerName).join(' & ')
  const championTotal = data.champions[0]?.totalPoints ?? 0

  return (
    <div style={{
      minHeight: '100vh', background: '#faf9f6',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Final Results</span>
        </div>
      </div>

      {/* ── Champion Hero ────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', padding: '28px 16px 32px', textAlign: 'center', overflow: 'hidden' }}>
        <ConfettiBurst />
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: '#a1791f', textTransform: 'uppercase', marginBottom: 6 }}>
          Event Complete
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: '#14532d', fontWeight: 700, marginBottom: 18 }}>
          {data.tripName}
        </div>
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 10 }}>🏆</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: '#14532d', letterSpacing: -0.3, marginBottom: 2, textTransform: 'uppercase' }}>
          {championNames || '—'}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: '#a1791f', textTransform: 'uppercase', marginBottom: 10 }}>
          {data.hasTie ? 'Joint Champions' : 'Event Champion'}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: '#c9a84c' }}>
          {championTotal} <span style={{ fontSize: 14, fontWeight: 700, color: '#a1791f' }}>POINTS</span>
        </div>
        {data.hasTie && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 10, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            {/* Release 2, item 1 follow-up — this used to say "no
                tie-break in place," which stopped being accurate the
                moment the countback ladder (multiRound.ts) landed:
                there IS a tie-break in place now, computed identically
                to the live leaderboard's own. If two players are still
                shown here as joint champions, it's because they're
                genuinely level all the way through it — cumulative
                points, final round, back nine, last 6, last 3, and
                every hole backwards — not because no tie-break exists. */}
            Genuinely level through every stage of countback — cumulative
            points, final round, back nine, and hole-by-hole. Joint
            champions, honestly.
          </p>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* ── Final Podium ──────────────────────────────────────────────── */}
        <SectionLabel>Final Podium</SectionLabel>
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 20 }}>
          {podium.map((tier, i) => (
            <div key={tier.position} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: i < podium.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{medal(tier.position)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                  {tier.players.map(p => p.playerName).join(' & ')}
                </div>
                {tier.players.length > 1 && (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>Tied</div>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18, color: '#7a5c00', flexShrink: 0 }}>
                {tier.players[0]?.totalPoints}
              </div>
            </div>
          ))}
        </div>

        {/* ── Final Leaderboard — dynamic R1..Rn | TOTAL columns, never
            hard-coded to a specific round count. ──────────────────────── */}
        <SectionLabel>Final Leaderboard</SectionLabel>
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#faf9f6', borderBottom: '1px solid #eceae3' }}>
            <div style={{ flex: 1, minWidth: 0 }} />
            {data.rounds.map(r => (
              <div key={r.roundId} style={{ width: 44, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, color: '#9ca3af' }}>
                R{r.roundNumber}
              </div>
            ))}
            <div style={{ width: 52, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, color: '#7a5c00' }}>
              TOTAL
            </div>
          </div>
          {data.standings.map((s, i) => (
            <div key={s.playerId} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px',
              borderBottom: i < data.standings.length - 1 ? '1px solid #f3f4f1' : 'none',
              background: s.position === positionGroups[0] ? '#fdf8ea' : 'transparent',
            }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: s.position <= 3 ? '#a1791f' : '#9ca3af', width: 18, flexShrink: 0 }}>
                  {s.position}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#14532d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.playerName}
                </span>
              </div>
              {s.rounds.map(r => (
                <div key={r.roundId} style={{ width: 44, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#4b5563' }}>
                  {r.points}
                </div>
              ))}
              <div style={{ width: 52, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, color: '#7a5c00' }}>
                {s.totalPoints}
              </div>
            </div>
          ))}
        </div>

        {/* ── Event Makers & Breakers (Release 2, items 4/5) — the same
            eventHighlights the API already computed via
            generateEventMakersAndBreakers, presented directly here.
            Clearly distinct from round-level Makers & Breakers (shown
            further down via Round Winners) — its own section, its own
            heading, event-scoped categories only. Omitted entirely
            (not an empty section) when the event genuinely produced no
            qualifying highlights — a 1-round event with sparse data can
            legitimately have nothing here. ──────────────────────────── */}
        {(data.eventHighlights.makers.length > 0 || data.eventHighlights.breakers.length > 0) && (
          <>
            <SectionLabel>🔥 Event Makers & Breakers</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 20 }}>
              {[...data.eventHighlights.makers, ...data.eventHighlights.breakers]
                .sort((a, b) => b.significance - a.significance)
                .map(h => <EventHighlightCard key={h.category} h={h} />)}
            </div>
          </>
        )}

        {/* ── Side Competition Winners — grouped by round, never
            collapsed. A competition existing in two rounds (e.g. NTP on
            both Round 1 and Round 2) shows as two separate entries with
            their own round/course heading — and two NTPs (or two
            Powerplay holes) within the SAME round each get their own row
            too, keyed by compType+holeNumber (unique per the DB's own
            UNIQUE(round_id, comp_type, hole_number) constraint), not by
            compType alone, which would collide. Empty rounds (no
            competitions configured, or none yet closed) simply
            contribute nothing — no empty section rendered. Powerplay is
            just another row in this same list now (own winner-shaped
            display via powerplayBest), not a separate round-level
            field. ─────────────────────────────────────────────────────── */}
        {data.sideCompetitionsByRound.some(r => r.competitions.some(c => c.winner || c.powerplayBest)) && (
          <>
            <SectionLabel>Side Competition Winners</SectionLabel>
            {data.sideCompetitionsByRound.map(round => {
              const shown = round.competitions.filter(c => c.winner || c.powerplayBest)
              if (shown.length === 0) return null
              return (
                <div key={round.roundId} style={{ marginBottom: 14 }}>
                  {data.sideCompetitionsByRound.length > 1 && (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Round {round.roundNumber}{round.courseName ? ` — ${round.courseName}` : ''}
                    </div>
                  )}
                  <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    {shown.map((c, i) => {
                      const meta = SIDE_COMP_LABELS[c.compType] ?? { icon: '🎯', label: c.compType }
                      const holeSuffix = c.holeNumber ? ` — Hole ${c.holeNumber}` : ''
                      return (
                        <div key={`${c.compType}-${c.holeNumber}`} style={{ padding: '11px 14px', borderBottom: i < shown.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                            {meta.icon} {meta.label}{holeSuffix}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                            {c.compType === 'powerplay' && c.powerplayBest
                              ? `${c.powerplayBest.playerName} — ${c.powerplayBest.points} pts`
                              : c.winner
                                ? `${c.winner.playerName}${c.winner.resultValue != null ? ` — ${c.winner.resultValue}m` : ''}`
                                : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ── Release 2, item 5 — round-by-round detail now sits BENEATH
            Event Makers & Breakers, per the required hierarchy (Champion
            → placings → Event M&B → round-by-round → controls). Round
            Winners moved down from its previous position directly after
            the Podium; nothing about its own content or logic changed. ── */}
        <SectionLabel>Round Winners</SectionLabel>
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 20 }}>
          {data.roundWinners.map((rw, i) => (
            <div key={rw.roundId} style={{ padding: '11px 14px', borderBottom: i < data.roundWinners.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                Round {rw.roundNumber}{rw.courseName ? ` — ${rw.courseName}` : ''}
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                {rw.winners.map(w => w.playerName).join(' & ')} — {rw.winners[0]?.points} pts
              </div>
            </div>
          ))}
        </div>

        {/* ── Event Story — the player-facing equivalent lives in My
            Golf (Release 2, item 6), filtered to one player from this
            exact same eventHighlights dataset. Nothing duplicated here
            — My HQ's job is presenting the whole event, not one
            player's chapter of it. */}

        <Link href={`/trips/${tripId}`} style={{
          display: 'block', textAlign: 'center', padding: 13, borderRadius: 10,
          background: '#ffffff', border: '1.5px solid #d1d5db',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', textDecoration: 'none',
        }}>
          ← Back to My HQ
        </Link>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#a1791f', marginBottom: 8 }}>
      {children}
    </div>
  )
}
