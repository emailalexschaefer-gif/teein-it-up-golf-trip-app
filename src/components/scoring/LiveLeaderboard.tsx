'use client'

// Sprint 5C.1 — Live Leaderboard.
//
// Consumes the existing leaderboard API (fixed as part of this change to
// stop double-counting self+marker score_entries — see the route for
// detail) via polling, matching the exact same offline-safe pattern already
// established for live scoring refresh (my-scores route): force-dynamic API
// route, React Query with a modest interval, refetchOnWindowFocus,
// refetchOnReconnect. No new live-sync mechanism was introduced.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'

interface PerHoleEntry {
  holeNumber: number
  par: number
  strokeIndex: number
  gross: number | null
  pickedUp: boolean
  points: number
}

interface LeaderboardEntry {
  playerId: string
  name: string
  avatarUrl: string | null
  handicap: number
  totalPts: number
  holesPlayed: number
  finished: boolean
  isCurrentUser: boolean
  position: number
  perHole: PerHoleEntry[]
}

interface CumulativeRoundEntry {
  roundId: string
  roundNumber: number
  points: number
  isCurrentRound: boolean
  holesPlayed: number | null
  finished: boolean
}

interface CumulativeStandingEntry {
  playerId: string
  playerName: string
  totalPoints: number
  position: number
  roundsPlayed: number
  rounds?: CumulativeRoundEntry[]
}

interface LeaderboardResponse {
  board: LeaderboardEntry[]
  roundId: string
  roundName: string
  scoringFormat: string
  totalHoles: number
  scoringNow: number
  finishedCount: number
  cumulativeStandings?: CumulativeStandingEntry[]
  roundsSummary?: { roundId: string; roundNumber: number }[]
}

type Movement = 'up' | 'down' | 'same'

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function formatScoringFormat(format: string): string {
  return format.charAt(0).toUpperCase() + format.slice(1).replace(/_/g, ' ')
}

function relativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export default function LiveLeaderboard({
  tripId, roundId, roundStatus,
}: { tripId: string; roundId: string; roundStatus: string }) {
  const prevPositions = useRef<Record<string, number> | null>(null)
  const [movements, setMovements] = useState<Record<string, Movement>>({})
  const [expanded, setExpanded] = useState(false)
  // Which player's scorecard is currently expanded inline — accordion
  // behaviour (only one at a time, per the explicit requirement), so
  // this is a single id, not a Set.
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)

  const { data, isLoading, error, dataUpdatedAt } = useQuery<LeaderboardResponse>({
    queryKey: ['leaderboard', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/leaderboard`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // TEMPORARY: surfaces the server's debug detail (if present),
        // matching the established pattern from other recent
        // investigations — previously this threw a generic error
        // without ever reading the response body, discarding any
        // server-side diagnostic detail.
        throw new Error(body.error ? `${body.error}${body.debug ? ` (${body.debug})` : ''}` : 'Could not load the leaderboard.')
      }
      return res.json()
    },
    // Only poll while the round is actually live — no point refreshing a
    // completed round's final standings every few seconds.
    refetchInterval: roundStatus === 'active' ? 8000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  })

  // A ticking counter, not used directly — just forces a re-render every
  // 10s so the "Last updated Xs ago" text stays current even between polls,
  // without re-fetching anything.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 10000)
    return () => clearInterval(id)
  }, [])

  // Compare this poll's positions against the last one to derive movement
  // arrows. Deliberately NOT persisted anywhere (no new state/query key) —
  // purely a client-side diff of two consecutive fetches of the existing
  // leaderboard output, so there's nothing new to keep in sync with the
  // scoring engine.
  useEffect(() => {
    if (!data) return
    const prev = prevPositions.current
    if (prev) {
      const next: Record<string, Movement> = {}
      for (const row of data.board) {
        const before = prev[row.playerId]
        if (before === undefined) next[row.playerId] = 'same'
        else if (row.position < before) next[row.playerId] = 'up'
        else if (row.position > before) next[row.playerId] = 'down'
        else next[row.playerId] = 'same'
      }
      setMovements(next)
    }
    const snapshot: Record<string, number> = {}
    for (const row of data.board) snapshot[row.playerId] = row.position
    prevPositions.current = snapshot
  }, [data])

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
        Loading leaderboard…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
        Couldn&apos;t load the leaderboard right now. It&apos;ll retry automatically.
        {/* TEMPORARY diagnostic detail — remove once this path is
            confirmed reliable. */}
        {error instanceof Error && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#c9a3a3' }}>{error.message}</div>
        )}
      </div>
    )
  }

  const topThree = data.board.slice(0, 3)
  const me = data.board.find(r => r.isCurrentUser)
  // Only show "your position" as a separate pinned row if you're not
  // already visible in the top three — no point showing yourself twice.
  const meOutsideTopThree = me && me.position > 3 ? me : null
  const visibleRows = expanded ? data.board : topThree

  // Round 2+ view: R1 | R2 LIVE | TOTAL table, TOTAL determines position.
  // Round 1 (roundsSummary.length === 1, i.e. no prior round exists yet)
  // keeps the simple single-round board above unchanged, per the explicit
  // "For Round 1: keep the current simple leaderboard" instruction.
  const cumulative = data.cumulativeStandings ?? []
  const isMultiRound = (data.roundsSummary?.length ?? 0) > 1 && cumulative.length > 0
  const cumTopThree = cumulative.slice(0, 3)
  const cumMe = me ? cumulative.find(c => c.playerId === me.playerId) : undefined
  const cumMeOutsideTopThree = cumMe && cumMe.position > 3 ? cumMe : null
  const cumVisibleRows = expanded ? cumulative : cumTopThree
  const boardByPlayerId = new Map(data.board.map(r => [r.playerId, r]))

  return (
    <div>
      {/* ── Tournament summary — the "home of the tournament" context ────── */}
      <div style={{
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 14, padding: '14px 16px',
        marginBottom: 14, boxShadow: '0 4px 18px rgba(20,83,45,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 16, fontWeight: 800 }}>
            {data.roundName}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 11, fontWeight: 700 }}>
            {formatScoringFormat(data.scoringFormat)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
          <span>{data.board.length} Player{data.board.length === 1 ? '' : 's'}</span>
          {data.scoringNow > 0 && <span>{data.scoringNow} Currently Scoring</span>}
          {data.finishedCount > 0 && <span>{data.finishedCount} Finished</span>}
        </div>
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 10.5, color: 'rgba(255,255,255,0.5)' }}>
          Last updated: {relativeTime(dataUpdatedAt)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800 }}>
          Standings
        </div>
        {roundStatus === 'active' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
            color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 10, padding: '2px 8px',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
            LIVE
          </span>
        )}
      </div>

      {isMultiRound ? (
        <>
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <MultiRoundHeaderRow rounds={data.roundsSummary ?? []} />
            {cumVisibleRows.map((row, i) => (
              <MultiRoundRow
                key={row.playerId}
                row={row}
                isCurrentUser={row.playerId === me?.playerId}
                isLast={i === cumVisibleRows.length - 1 && !cumMeOutsideTopThree}
                isExpanded={expandedPlayerId === row.playerId}
                onToggle={() => setExpandedPlayerId(id => id === row.playerId ? null : row.playerId)}
                boardRow={boardByPlayerId.get(row.playerId)}
                totalHoles={data.totalHoles}
              />
            ))}

            {!expanded && cumMeOutsideTopThree && (
              <>
                <div style={{ padding: '4px 14px', fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: '#9ca3af', background: '#faf9f6', borderTop: '1px solid #eceae3', borderBottom: '1px solid #eceae3' }}>
                  YOUR POSITION
                </div>
                <MultiRoundRow
                  row={cumMeOutsideTopThree}
                  isCurrentUser
                  isLast
                  isExpanded={expandedPlayerId === cumMeOutsideTopThree.playerId}
                  onToggle={() => setExpandedPlayerId(id => id === cumMeOutsideTopThree.playerId ? null : cumMeOutsideTopThree.playerId)}
                  boardRow={boardByPlayerId.get(cumMeOutsideTopThree.playerId)}
                  totalHoles={data.totalHoles}
                />
              </>
            )}
          </div>

          {cumulative.length > 3 && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                width: '100%', marginTop: 8, padding: 10,
                background: '#ffffff', border: '1.5px solid #d1d5db', borderRadius: 10,
                fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d',
                cursor: 'pointer',
              }}
            >
              {expanded ? '↑ Show top 3 only' : `↓ Show full leaderboard (${cumulative.length})`}
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            {data.board.length === 0 && (
              <div style={{ padding: '20px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
                No scores yet — the leaderboard fills in as players confirm holes.
              </div>
            )}
            {visibleRows.map((row, i) => (
              <LeaderboardRow key={row.playerId} row={row} movement={movements[row.playerId] ?? 'same'} isLast={i === visibleRows.length - 1 && !meOutsideTopThree} isExpanded={expandedPlayerId === row.playerId} onToggle={() => setExpandedPlayerId(id => id === row.playerId ? null : row.playerId)} totalHoles={data.totalHoles} />
            ))}

            {/* Pinned "your position" row — only shown collapsed and only if
                you're not already in the visible top three. */}
            {!expanded && meOutsideTopThree && (
              <>
                <div style={{ padding: '4px 14px', fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: '#9ca3af', background: '#faf9f6', borderTop: '1px solid #eceae3', borderBottom: '1px solid #eceae3' }}>
                  YOUR POSITION
                </div>
                <LeaderboardRow row={meOutsideTopThree} movement={movements[meOutsideTopThree.playerId] ?? 'same'} isLast isExpanded={expandedPlayerId === meOutsideTopThree.playerId} onToggle={() => setExpandedPlayerId(id => id === meOutsideTopThree.playerId ? null : meOutsideTopThree.playerId)} totalHoles={data.totalHoles} />
              </>
            )}
          </div>

          {data.board.length > 3 && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                width: '100%', marginTop: 8, padding: 10,
                background: '#ffffff', border: '1.5px solid #d1d5db', borderRadius: 10,
                fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d',
                cursor: 'pointer',
              }}
            >
              {expanded ? '↑ Show top 3 only' : `↓ Show full leaderboard (${data.board.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

interface LeaderboardRowProps { row: LeaderboardEntry; movement: Movement; isLast: boolean; isExpanded: boolean; onToggle: () => void; totalHoles: number }

function LeaderboardRow({ row, movement, isLast, isExpanded, onToggle, totalHoles }: LeaderboardRowProps) {
  return (
    <div style={{ borderBottom: isLast && !isExpanded ? 'none' : '1px solid #eceae3' }}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: row.isCurrentUser ? '#fdf3d9' : row.position === 1 ? '#f7fdf9' : 'transparent',
          transition: 'background 0.4s ease',
          cursor: 'pointer',
        }}
      >
        <div style={{ width: 22, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: row.position <= 3 ? '#a1791f' : '#9ca3af' }}>
          {MEDAL[row.position] ?? row.position}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: 'radial-gradient(#e8c96a,#c9a84c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11,
          }}>
            {initialsOf(row.name)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Bug fix: previously forced to one line (whiteSpace: nowrap
                + ellipsis), which on realistic mobile widths clipped
                "(you)" and sometimes the surname itself before the R1/R2/
                TOTAL columns even got a chance to compress. The name is
                more important than the extra vertical space a wrapped
                second line costs — not solved by shrinking the font. */}
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', lineHeight: 1.25, wordBreak: 'break-word' }}>
              {row.name}{row.isCurrentUser ? ' (you)' : ''}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af' }}>
              {row.finished ? 'Finished' : row.holesPlayed > 0 ? `Thru ${row.holesPlayed}` : 'Not started'}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: '#14532d' }}>
            {row.totalPts} <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>pts</span>
          </div>
        </div>

        <div style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>
          {movement === 'up' && <span style={{ color: '#16a34a', fontSize: 13 }}>▲</span>}
          {movement === 'down' && <span style={{ color: '#dc2626', fontSize: 13 }}>▼</span>}
          {movement === 'same' && <span style={{ color: '#d1d5db', fontSize: 11 }}>–</span>}
        </div>

        {/* Chevron — the subtle expand affordance the brief asks for,
            distinct from the movement arrow above it. */}
        <div style={{ width: 14, textAlign: 'center', flexShrink: 0, color: '#c9a84c', fontSize: 11, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
          ▾
        </div>
      </div>

      {isExpanded && <InlineScorecard row={row} totalHoles={totalHoles} />}
    </div>
  )
}

/**
 * Column header row for the Round 2+ multi-round table: PLAYER | R1 | R2
 * LIVE | TOTAL, extending naturally for 3+ rounds. `rounds` comes
 * straight from the leaderboard API's roundsSummary — no separate
 * round-count logic on the client.
 */
function MultiRoundHeaderRow({ rounds }: { rounds: { roundId: string; roundNumber: number }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#faf9f6', borderBottom: '1px solid #eceae3' }}>
      <div style={{ flex: 1, minWidth: 0 }} />
      {rounds.map((r, i) => (
        <div key={r.roundId} style={{ width: 52, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: '#9ca3af' }}>
          R{r.roundNumber}{i === rounds.length - 1 ? ' LIVE' : ''}
        </div>
      ))}
      <div style={{ width: 56, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: '#7a5c00' }}>
        TOTAL
      </div>
      <div style={{ width: 14, flexShrink: 0 }} />
    </div>
  )
}

interface MultiRoundRowProps {
  row: CumulativeStandingEntry
  isCurrentUser: boolean
  isLast: boolean
  isExpanded: boolean
  onToggle: () => void
  boardRow: LeaderboardEntry | undefined
  totalHoles: number
}

/**
 * One player's row in the Round 2+ table. TOTAL and rank both come
 * straight from the row's own `position`/`totalPoints` (already computed
 * server-side by computeCumulativeStandings — the single source of
 * truth per the brief). TOTAL is rendered visually strongest (largest,
 * boldest, gold-accented) so it reads as the number that matters.
 * Expanding still shows the current round's hole-by-hole detail via the
 * existing InlineScorecard — same component the single-round view uses,
 * fed from `boardRow` (this round's own board entry for this player).
 */
function MultiRoundRow({ row, isCurrentUser, isLast, isExpanded, onToggle, boardRow, totalHoles }: MultiRoundRowProps) {
  return (
    <div style={{ borderBottom: isLast && !isExpanded ? 'none' : '1px solid #eceae3' }}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 14px',
          background: isCurrentUser ? '#fdf3d9' : row.position === 1 ? '#f7fdf9' : 'transparent',
          transition: 'background 0.4s ease',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ width: 18, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12.5, color: row.position <= 3 ? '#a1791f' : '#9ca3af' }}>
            {MEDAL[row.position] ?? row.position}
          </div>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: 'radial-gradient(#e8c96a,#c9a84c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 9.5,
          }}>
            {initialsOf(row.playerName)}
          </div>
          {/* Bug fix: same as the single-round row above — this cell has
              even less room to work with (rank + avatar + however many
              round columns + TOTAL all compete for width on the same
              row), so it was the more visibly broken case on mobile
              ("Darren Lappen (..."). Wraps instead of clipping; the
              rank/avatar widths above were trimmed slightly (not the
              font) to give the name more room without needing to shrink
              anything the person actually reads. */}
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', lineHeight: 1.25, wordBreak: 'break-word', minWidth: 0 }}>
            {row.playerName}{isCurrentUser ? ' (you)' : ''}
          </div>
        </div>

        {(row.rounds ?? []).map(r => (
          <div key={r.roundId} style={{ width: 52, textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: r.isCurrentRound ? '#14532d' : '#4b5563' }}>
              {r.points}
            </div>
            {r.isCurrentRound && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: '#9ca3af', marginTop: 1 }}>
                {r.finished ? 'Finished' : (r.holesPlayed ?? 0) > 0 ? `Thru ${r.holesPlayed}` : 'Not started'}
              </div>
            )}
          </div>
        ))}

        <div style={{ width: 56, textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 19, color: '#7a5c00' }}>
            {row.totalPoints}
          </div>
        </div>

        <div style={{ width: 14, textAlign: 'center', flexShrink: 0, color: '#c9a84c', fontSize: 11, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
          ▾
        </div>
      </div>

      {isExpanded && (
        boardRow
          ? <InlineScorecard row={boardRow} totalHoles={totalHoles} />
          : (
            <div style={{ padding: '10px 14px 14px', background: '#faf9f6' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
                No holes entered yet this round.
              </p>
            </div>
          )
      )}
    </div>
  )
}

/**
 * Inline expanded scorecard — reuses the per-hole data the leaderboard
 * API now includes in its existing response (see the route: same
 * score_entries query already being polled every 8s, capture_role='self'
 * as the authoritative source, same convention as everywhere else in the
 * app), not a new fetch or a second scoring calculation. Horizontal
 * scroll is contained to this element only, so the page itself never
 * overflows even for an 18-hole round on a narrow screen.
 */
function InlineScorecard({ row, totalHoles }: { row: LeaderboardEntry; totalHoles: number }) {
  const front9 = row.perHole.filter(h => h.holeNumber <= 9)
  const back9  = row.perHole.filter(h => h.holeNumber > 9)
  const front9Pts = front9.reduce((s, h) => s + h.points, 0)
  const back9Pts  = back9.reduce((s, h) => s + h.points, 0)

  if (row.perHole.length === 0) {
    return (
      <div style={{ padding: '10px 14px 14px', background: '#faf9f6' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
          No holes entered yet.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '10px 14px 14px', background: '#faf9f6' }}>
      {/* Fix Batch 5 — root cause: a fixed 5-fields-per-column table
          (minWidth 560px for 18 holes) with 34px-wide columns and 8.5-14px
          fonts, relying entirely on horizontal scroll on narrow screens.
          Not a font/padding tweak — the table structure itself doesn't
          fit a phone viewport. Below sm (640px, the same breakpoint
          already used elsewhere in this app, e.g. AppNav's own "+ New
          Trip" button), a stacked vertical list replaces it — one full-
          width row per hole, so nothing is ever cramped into a ~34px
          column and no horizontal scroll is needed regardless of hole
          count. At sm and above, the existing table is unchanged —
          confirmed working well there, not touched. Same underlying
          row.perHole data either way; this is presentation-only. */}
      <div className="sm:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {row.perHole.map((h, i) => (
          <div
            key={h.holeNumber}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 4px', borderBottom: i < row.perHole.length - 1 ? '1px solid #ede7d8' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: '#14532d', width: 26, flexShrink: 0 }}>
                H{h.holeNumber}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                Par {h.par} · SI {h.strokeIndex}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>
                {h.pickedUp ? 'P' : h.gross ?? '—'}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}>
                {h.points} pt{h.points === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: totalHoles > 9 ? 560 : 320 }}>
          <thead>
            <tr>
              {row.perHole.map(h => (
                <th key={h.holeNumber} style={{ padding: '2px 6px', fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#9ca3af', textAlign: 'center', minWidth: 34 }}>
                  H{h.holeNumber}
                </th>
              ))}
            </tr>
            <tr>
              {row.perHole.map(h => (
                <th key={h.holeNumber} style={{ padding: '0 6px 4px', fontFamily: 'var(--font-body)', fontSize: 8.5, fontWeight: 600, color: '#c9b896', textAlign: 'center' }}>
                  Par {h.par} · SI {h.strokeIndex}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {row.perHole.map(h => (
                <td key={h.holeNumber} style={{ padding: '2px 6px', textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#14532d' }}>
                  {h.pickedUp ? 'P' : h.gross ?? '—'}
                </td>
              ))}
            </tr>
            <tr>
              {row.perHole.map(h => (
                <td key={h.holeNumber} style={{ padding: '0 6px 4px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#a1791f', fontWeight: 700 }}>
                  {h.points} pt{h.points === 1 ? '' : 's'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Front 9 / Back 9 / Total — only shown where applicable, matching
          the brief's own qualifier, computed from the same perHole data
          above rather than a separate calculation. */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151' }}>
        {front9.length > 0 && <span>Front 9: <strong>{front9Pts}</strong></span>}
        {back9.length > 0 && <span>Back 9: <strong>{back9Pts}</strong></span>}
        <span>Total: <strong style={{ color: '#14532d' }}>{row.totalPts}</strong></span>
      </div>
    </div>
  )
}
