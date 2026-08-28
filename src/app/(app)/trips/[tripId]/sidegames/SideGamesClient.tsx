'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface Leader { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null }
interface HistoryEntry { playerName: string; resultValue: number | null; sequenceNumber: number }
interface Competition {
  id: string; compType: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'powerplay'; holeNumber: number | null
  currentLeader: Leader | null; leadChangeCount: number; hotlyContested: boolean
  isComplete: boolean; winner: Leader | null; history: HistoryEntry[]
  // Only meaningful for compType === 'powerplay' — a different kind of
  // "result" (best authoritative score, not a submitted leader).
  powerplayBest: { playerId: string; playerName: string; points: number } | null
}
interface RoundSideGames {
  roundId: string; roundNumber: number; roundName: string; courseName: string | null; status: string
  competitions: Competition[]
}
interface SideGamesData {
  roundsData: RoundSideGames[]
}

const COMP_META: Record<Competition['compType'], { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
  powerplay:     { icon: '⚡', label: 'Powerplay' },
}

/**
 * Event-level by default now, not round-specific — the earlier design
 * (single active/most-recent round only, "never a merged view across
 * rounds") was a deliberate choice at the time, but didn't match what
 * players actually needed once trips grew past one round: Side Games
 * results/history from completed rounds must stay visible, not vanish
 * the moment the next round starts. Fetches every relevant round from
 * the new event-level route in one call — grouped by round in the
 * response already, so this component doesn't need to re-derive
 * grouping, only render it. Individual-round drill-down still exists
 * (the original single-round route, unchanged) — just not wired into
 * this default screen, which was the whole point of the fix.
 */
export default function SideGamesClient({ tripId }: { tripId: string }) {
  const { data, isLoading } = useQuery<SideGamesData>({
    queryKey: ['side-games-event', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/side-games`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    // Polls whenever ANY relevant round is active — matches the
    // leaderboard's own reasoning (only refresh when something could
    // actually be changing), just evaluated across the whole set rather
    // than a single round.
    refetchInterval: (query) => (query.state.data?.roundsData ?? []).some(r => r.status === 'active') ? 8000 : false,
  })

  // P0 field-test fix — rounds with zero competitions used to be
  // silently omitted entirely (roundsWithContent filtered them out),
  // which is exactly what produced the reported "it looks like the app
  // may still be showing the current round" confusion: a round with no
  // Side Games configured just vanished from the list rather than
  // being shown as "no games this round," making it look like the app
  // had forgotten it existed. Now every relevant round is shown, with
  // an explicit empty state for the ones with nothing configured —
  // matching the brief's own example output exactly ("Round 2 — Side
  // Games / No Side Games played this round").
  const relevantRounds = data?.roundsData ?? []

  return (
    <div style={{
      minHeight: '100vh', background: '#faf9f6',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
      padding: '16px 16px 90px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Side Games</span>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
          Loading Side Games…
        </div>
      ) : relevantRounds.length === 0 ? (
        // Positive framing — the organiser may not have configured any
        // Side Competitions/Powerplay for this trip yet, which is a
        // completely normal, valid state (not every trip runs them),
        // not something "missing." Explains what this area is rather
        // than reporting an absence. Distinct from the per-round empty
        // state below — this is "no rounds have reached scoring yet at
        // all," not "this specific round had none configured."
        <EmptyState text="Nearest the Pin, Longest Drive, and Powerplay competitions will appear here whenever your organiser sets them up for a round." />
      ) : (
        // Grouped by round, never merged — a round heading only shown
        // when there's more than one relevant round, matching the same
        // "don't clutter a single-round trip" reasoning used elsewhere
        // (e.g. Final Results' own round-grouping).
        //
        // Bug 6 (field-test corrective) — roundsData itself stays
        // chronologically ascending (oldest first), since that's also
        // what determines each round's correct roundNumber elsewhere in
        // this same response and in the /side-games route's own
        // construction — reversing that shared ordering would risk
        // breaking roundNumber for something that's purely a display
        // concern here. This [...].reverse() only changes which order
        // this specific list renders in (most recent round first, per
        // the explicit "reverse that presentation priority" instruction
        // — during Round 2, the player shouldn't have to scroll past
        // Round 1's history to reach what's live now), on a small,
        // already-materialised array — every round's own real
        // roundId/roundNumber stays exactly as computed, nothing here
        // infers identity from this reversed position.
        [...relevantRounds].reverse().map(round => (
          <div key={round.roundId} style={{ marginBottom: 20 }}>
            {relevantRounds.length > 1 && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {/* Bug 6 (field-test corrective) — round.roundName is
                    the organiser's own name for the round, which is
                    typically already "Round 1"/"Round 2" by default.
                    Prepending "Round {roundNumber} —" in front of a
                    name that already says "Round 1" produced exactly
                    the reported "ROUND 1 — ROUND 1 · Eagle Ridge Golf
                    Club" duplicate. Using roundName directly reads
                    correctly whether the organiser kept the default
                    name or renamed it to something custom like "Final
                    Round" — either way there's now only one round
                    identifier, not two. */}
                {round.roundName}{round.courseName ? ` · ${round.courseName}` : ''}
                {round.status === 'active' && <span style={{ color: '#16a34a', marginLeft: 6 }}>● LIVE</span>}
              </div>
            )}
            {/* Every configured instance renders as its own card, keyed by
                its own id — two NTPs or two Powerplay holes each get a
                separate card, never merged. A side comp from Round 1 and
                a same-type one from Round 2 are entirely separate
                side_comp_ids, so they naturally never collide here either,
                grouped under their own round section. */}
            {round.competitions.length > 0 ? (
              round.competitions.map(comp => <CompetitionCard key={comp.id} comp={comp} />)
            ) : (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', padding: '4px 2px' }}>
                No Side Games played this round.
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <p style={{ fontSize: 36, marginBottom: 10 }}>🎯</p>
      <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, maxWidth: 300, margin: '0 auto', lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  )
}

function CompetitionCard({ comp }: { comp: Competition }) {
  const [expanded, setExpanded] = useState(false)
  const meta = COMP_META[comp.compType]
  const displayed = comp.isComplete ? comp.winner : comp.currentLeader

  // Powerplay is a different kind of card entirely — no leader, no
  // leadership history, just the best authoritative score on this
  // specific hole. Rendered independently per instance (own card, own
  // id), so two Powerplay holes never get merged into one card.
  if (comp.compType === 'powerplay') {
    return (
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#7a5c00' }}>
          {meta.icon} {meta.label}{comp.holeNumber ? ` — Hole ${comp.holeNumber}` : ''}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2, marginBottom: 8 }}>
          2× Stableford Points
        </div>
        {comp.powerplayBest ? (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>
            Best so far: {comp.powerplayBest.playerName} — {comp.powerplayBest.points} pts
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>No scores on this hole yet.</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#7a5c00' }}>
            {meta.icon} {meta.label}{comp.holeNumber ? ` — Hole ${comp.holeNumber}` : ''}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
            {comp.isComplete ? '🏆 Winner' : 'Current leader'}
          </div>
        </div>
        {comp.hotlyContested && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>
            🔥 HOTLY CONTESTED
          </span>
        )}
      </div>

      {displayed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {displayed.momentUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset
            <img src={displayed.momentUrl} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
            {/* Field-Test Fix Package, item 5 — Longest Drive is a
                current-leader/challenger competition, not a
                distance-measured one (this app never captures an
                actual distance for it — resultValue is a placeholder,
                confirmed by the "Marnie 0m" screenshot showing a
                literal 0). Every other resultValue-based comp type
                (Nearest the Pin, Pro's Approach) keeps its distance
                display completely unchanged — this is scoped to
                longest_drive specifically, not a global removal of
                measurement formatting. */}
            {displayed.playerName}{(comp.compType !== 'longest_drive' && displayed.resultValue != null) ? ` — ${displayed.resultValue}m` : ''}
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', marginTop: 8 }}>
          No results yet.
        </div>
      )}

      {comp.leadChangeCount > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}
        >
          {expanded ? '▲ Hide' : '▼'} {comp.leadChangeCount} lead change{comp.leadChangeCount === 1 ? '' : 's'}{comp.hotlyContested ? ' 🔥' : ''}
        </button>
      )}

      {expanded && comp.history.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f1', fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
          {comp.history.map((h, i) => (
            <span key={i}>
              {h.playerName}{(comp.compType !== 'longest_drive' && h.resultValue != null) ? ` ${h.resultValue}m` : ''}
              {i < comp.history.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
