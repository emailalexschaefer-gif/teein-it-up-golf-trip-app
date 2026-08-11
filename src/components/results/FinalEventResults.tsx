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
  competitions: { compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'; holeNumber: number | null; winner: SideCompWinner | null }[]
  powerplay: { holeNumber: number; best: { playerId: string; playerName: string; points: number } | null } | null
}
interface FinalResults {
  tripName: string
  rounds: RoundRef[]
  standings: Standing[]
  roundWinners: RoundWinner[]
  champions: Champion[]
  hasTie: boolean
  sideCompetitionsByRound: RoundSideCompetitions[]
}

const SIDE_COMP_LABELS: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
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
            Level on points with no tie-break in place — both champions, honestly.
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

        {/* ── Round Winners ─────────────────────────────────────────────── */}
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

        {/* ── Side Competition Winners — grouped by round, never
            collapsed. A competition existing in two rounds (e.g. NTP on
            both Round 1 and Round 2) shows as two separate entries with
            their own round/course heading. Empty rounds (no competitions
            configured, or none yet closed) simply contribute nothing —
            no empty section rendered. ──────────────────────────────────── */}
        {data.sideCompetitionsByRound.some(r => r.competitions.some(c => c.winner) || r.powerplay?.best) && (
          <>
            <SectionLabel>Side Competition Winners</SectionLabel>
            {data.sideCompetitionsByRound.map(round => {
              const hasContent = round.competitions.some(c => c.winner) || round.powerplay?.best
              if (!hasContent) return null
              return (
                <div key={round.roundId} style={{ marginBottom: 14 }}>
                  {data.sideCompetitionsByRound.length > 1 && (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Round {round.roundNumber}{round.courseName ? ` — ${round.courseName}` : ''}
                    </div>
                  )}
                  <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                    {round.competitions.filter(c => c.winner).map((c, i, arr) => {
                      const meta = SIDE_COMP_LABELS[c.compType] ?? { icon: '🎯', label: c.compType }
                      return (
                        <div key={c.compType} style={{ padding: '11px 14px', borderBottom: (i < arr.length - 1 || round.powerplay?.best) ? '1px solid #f3f4f1' : 'none' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                            {meta.icon} {meta.label}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                            {c.winner!.playerName}{c.winner!.resultValue != null ? ` — ${c.winner!.resultValue}m` : ''}
                          </div>
                        </div>
                      )
                    })}
                    {round.powerplay?.best && (
                      <div style={{ padding: '11px 14px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
                          ⚡ Powerplay Highlight
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                          {round.powerplay.best.playerName} — {round.powerplay.best.points} pts
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ── Event Story — placeholder only, per the explicit "prepare,
            don't build" instruction for this sprint. ────────────────────── */}
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1.5px dashed #d9c9a3', padding: '18px 16px', textAlign: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 22, marginBottom: 6 }}>📖</p>
          <p style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', marginBottom: 2 }}>Event Story</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>Coming soon</p>
        </div>

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
