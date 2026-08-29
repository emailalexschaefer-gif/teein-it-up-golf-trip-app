/**
 * Event-level Makers & Breakers — Release 2, item 4.
 *
 * The one reusable analysis layer for the WHOLE event (all completed
 * rounds, chronologically), consumed identically by My HQ's Final
 * Results (item 5) and My Golf's Event Story (item 6). No separate
 * calculation path exists anywhere else — both surfaces call
 * `generateEventMakersAndBreakers` and either present the full list
 * (My HQ) or filter it down to one player (My Golf), never
 * recomputing anything.
 *
 * Deliberately reuses the exact same primitives the round-level engine
 * (makersBreakers.ts) already established rather than inventing
 * parallel definitions: `sumPts`, `birdieCount`, `wipeCount`,
 * `parCount`, `doubleBogeyOrWorseCount` (gross-one-under-par,
 * zero-Stableford-point, gross-equal-par, gross-two-over-par — the
 * same conventions the round-level slideshow already uses), and
 * `computeCumulativeStandings`/`determineChampions` from multiRound.ts
 * for the Event Champion category specifically, since that's already
 * the canonical, countback-aware ranking — this module has no opinion
 * of its own about who wins the event overall, it only asks
 * multiRound.ts and reports the answer.
 *
 * Player identity is always by playerId (stable, from profiles), never
 * playerName — aggregating across rounds by name would silently merge
 * two different people who happen to share a display name, or fail to
 * aggregate the same person if their name was ever edited.
 */

import type { PlayerRoundData, PlayerHoleResult } from './makersBreakers'
import { sumPts, birdieCount, wipeCount, parCount, doubleBogeyOrWorseCount } from './makersBreakers'
import { computeCumulativeStandings, determineChampions, type RoundPlayerResult } from '@/lib/scoring/multiRound'

export interface EventRoundData {
  roundId: string
  // 1-indexed CHRONOLOGICAL position — the caller's responsibility to
  // supply correctly (reusing sortRoundsChronologically), exactly like
  // every other multi-round consumer in this app. Never re-derived here.
  roundNumber: number
  totalHoles: number
  players: PlayerRoundData[]
}

export interface EventFieldData {
  // Completed rounds only — an incomplete/active/upcoming round must
  // never be included by the caller. This module trusts that contract
  // rather than re-deriving round status itself, matching "event-level
  // results should be derived from completed round data only."
  rounds: EventRoundData[]
}

export interface EventHighlight {
  category: string
  kind: 'maker' | 'breaker'
  scope: 'individual' | 'group'
  title: string
  definition?: string
  // Joint winners are a first-class case, not an afterthought — every
  // one of these is an array, even when there's exactly one winner.
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

function completedPlayers(round: EventRoundData): PlayerRoundData[] {
  // A player is only "complete" for a round if they have holes
  // recorded at all — mirrors the round-level engine's own
  // `complete` filter (a scorecard with zero holes contributes nothing
  // to any average/count and would otherwise silently drag several
  // stats toward zero).
  return round.players.filter(p => p.holes.length > 0)
}

/** playerId -> { playerName, rounds: [{ roundId, roundNumber, totalHoles, holes }] }, chronologically ordered as the caller supplied them. */
function buildPlayerIndex(rounds: EventRoundData[]) {
  const index = new Map<string, { playerName: string; entries: { roundId: string; roundNumber: number; totalHoles: number; player: PlayerRoundData }[] }>()
  for (const round of rounds) {
    for (const p of completedPlayers(round)) {
      const existing = index.get(p.playerId)
      const entry = { roundId: round.roundId, roundNumber: round.roundNumber, totalHoles: round.totalHoles, player: p }
      if (existing) existing.entries.push(entry)
      else index.set(p.playerId, { playerName: p.playerName, entries: [entry] })
    }
  }
  return index
}

/**
 * The single entry point. Returns event-wide makers and breakers,
 * ordered strongest-first within each list. Categories with no
 * meaningful qualifying data are simply absent — never a fabricated
 * "0 wipes champion."
 */
export function generateEventMakersAndBreakers(field: EventFieldData): { makers: EventHighlight[]; breakers: EventHighlight[] } {
  const rounds = field.rounds
  const playerIndex = buildPlayerIndex(rounds)
  const makers: (EventHighlight | null)[] = []
  const breakers: (EventHighlight | null)[] = []

  // ── Event Champion — reuses multiRound.ts's own canonical,
  // countback-aware ranking entirely. No second "who won" concept. ────
  if (rounds.length > 0) {
    const roundPlayerResults: RoundPlayerResult[][] = rounds.map(round =>
      completedPlayers(round).map(p => ({
        playerId: p.playerId, playerName: p.playerName, roundPoints: sumPts(p.holes),
        holePoints: p.holes.map(h => h.stablefordPts),
      }))
    )
    const standings = computeCumulativeStandings(roundPlayerResults)
    const champions = determineChampions(standings)
    if (champions.length > 0) {
      makers.push({
        category: 'event_champion', kind: 'maker', scope: 'individual',
        title: 'Event Champion', definition: 'The best result across the whole event.',
        playerIds: champions.map(c => c.playerId), playerNames: champions.map(c => c.playerName),
        statValue: champions[0].totalPoints, statLine: `${champions[0].totalPoints} pts across ${rounds.length} round${rounds.length === 1 ? '' : 's'}`,
        significance: 1000, // always the headline, when it exists at all
      })
    }
  }

  // ── Most Stableford points (the raw stat, distinct from Champion —
  // usually the same player, but this is the number itself, not the
  // countback-resolved position). ──────────────────────────────────────
  makers.push(pickEventStatWinner(playerIndex, 'most_points', 'maker', 'Most Points',
    'The highest total Stableford points across the event.',
    entries => entries.reduce((s, e) => s + sumPts(e.player.holes), 0),
    v => `${v} pts total`, 1))

  // ── Most birdies ──────────────────────────────────────────────────────
  makers.push(pickEventStatWinner(playerIndex, 'most_birdies', 'maker', 'Most Birdies',
    'The most gross birdies across every round played.',
    entries => entries.reduce((s, e) => s + birdieCount(e.player), 0),
    v => `${v} birdie${v === 1 ? '' : 's'}`, 1, /* minimum */ 1))

  // ── Most pars ───────────────────────────────────────────────────────
  makers.push(pickEventStatWinner(playerIndex, 'most_pars', 'maker', 'Most Pars',
    'Rock solid — the most gross pars across the event.',
    entries => entries.reduce((s, e) => s + parCount(e.player), 0),
    v => `${v} par${v === 1 ? '' : 's'}`, 1, 1))

  // ── Best single round ──────────────────────────────────────────────
  makers.push(pickBestSingleRound(playerIndex))

  // ── Biggest improvement round-to-round ─────────────────────────────
  makers.push(pickBiggestSwing(playerIndex, 'biggest_improver', 'maker', 'Biggest Improver',
    'The largest jump in points from one round to the next.', 'improved by'))

  // ── Best group/team performance, if group data exists ──────────────
  makers.push(pickBestGroupPerformance(rounds))

  // ── Breakers ────────────────────────────────────────────────────────
  breakers.push(pickEventStatWinner(playerIndex, 'most_wipes', 'breaker', 'Most Wipes',
    'The most zero-point holes across the whole event.',
    entries => entries.reduce((s, e) => s + wipeCount(e.player), 0),
    v => `${v} wipe${v === 1 ? '' : 's'}`, 1, 1))

  breakers.push(pickEventStatWinner(playerIndex, 'most_double_bogeys', 'breaker', 'Most Double Bogeys (or worse)',
    'The most holes at double bogey or worse across the event.',
    entries => entries.reduce((s, e) => s + doubleBogeyOrWorseCount(e.player), 0),
    v => `${v} hole${v === 1 ? '' : 's'}`, 1, 1))

  breakers.push(pickToughestHoleVictim(playerIndex))
  breakers.push(pickBiggestSwing(playerIndex, 'biggest_decline', 'breaker', 'Wheels Fell Off',
    'The largest drop in points from one round to the next.', 'dropped by'))
  breakers.push(pickWorstGroupStretch(rounds))

  const clean = (list: (EventHighlight | null)[]) => list.filter((h): h is EventHighlight => h !== null).sort((a, b) => b.significance - a.significance)
  return { makers: clean(makers), breakers: clean(breakers) }
}

type PlayerEntries = { roundId: string; roundNumber: number; totalHoles: number; player: PlayerRoundData }[]

/**
 * Generic "sum a stat across every round a player appears in, find the
 * event-wide leader(s)" category — ties become joint winners, never an
 * arbitrary pick. `minimum`, when given, excludes a "winner" of 0 (or
 * below) from ever being reported, satisfying "do not show nonsense
 * such as '0 wipes champion.'"
 */
function pickEventStatWinner(
  playerIndex: Map<string, { playerName: string; entries: PlayerEntries }>,
  category: string, kind: 'maker' | 'breaker', title: string, definition: string,
  statFn: (entries: PlayerEntries) => number, lineFn: (v: number) => string,
  significance: number, minimum?: number,
): EventHighlight | null {
  const candidates = [...playerIndex.entries()].map(([playerId, v]) => ({ playerId, playerName: v.playerName, value: statFn(v.entries) }))
  if (candidates.length === 0) return null
  const maxValue = Math.max(...candidates.map(c => c.value))
  if (minimum !== undefined && maxValue < minimum) return null
  const winners = candidates.filter(c => c.value === maxValue)
  return {
    category, kind, scope: 'individual', title, definition,
    playerIds: winners.map(w => w.playerId), playerNames: winners.map(w => w.playerName),
    statValue: maxValue, statLine: lineFn(maxValue), significance: significance * 100 + maxValue,
  }
}

function pickBestSingleRound(playerIndex: Map<string, { playerName: string; entries: PlayerEntries }>): EventHighlight | null {
  let best: { playerId: string; playerName: string; roundId: string; roundNumber: number; pts: number } | null = null
  for (const [playerId, v] of playerIndex) {
    for (const e of v.entries) {
      const pts = sumPts(e.player.holes)
      if (!best || pts > best.pts) best = { playerId, playerName: v.playerName, roundId: e.roundId, roundNumber: e.roundNumber, pts }
    }
  }
  if (!best) return null
  return {
    category: 'best_single_round', kind: 'maker', scope: 'individual', title: 'Best Round',
    definition: 'The single strongest round anyone posted across the event.',
    playerIds: [best.playerId], playerNames: [best.playerName],
    roundId: best.roundId, roundNumber: best.roundNumber,
    statValue: best.pts, statLine: `${best.pts} pts in Round ${best.roundNumber}`,
    significance: 900,
  }
}

/**
 * Round-to-round swing — the largest CONSECUTIVE-round change in
 * points, either direction. Requires at least 2 rounds actually played
 * by that specific player (a player who only appears in one round has
 * nothing to compare, and is correctly excluded rather than compared
 * against a phantom zero).
 */
function pickBiggestSwing(
  playerIndex: Map<string, { playerName: string; entries: PlayerEntries }>,
  category: string, kind: 'maker' | 'breaker', title: string, definition: string, verb: string,
): EventHighlight | null {
  let best: { playerId: string; playerName: string; delta: number; fromRound: number; toRound: number } | null = null
  for (const [playerId, v] of playerIndex) {
    if (v.entries.length < 2) continue
    // Entries are in chronological order (the caller's contract on
    // EventFieldData.rounds), so consecutive array pairs ARE consecutive
    // rounds — no re-sorting needed here.
    for (let i = 1; i < v.entries.length; i++) {
      const prevPts = sumPts(v.entries[i - 1].player.holes)
      const currPts = sumPts(v.entries[i].player.holes)
      const delta = currPts - prevPts
      const wanted = kind === 'maker' ? delta : -delta
      if (!best || wanted > (kind === 'maker' ? best.delta : -best.delta)) {
        best = { playerId, playerName: v.playerName, delta, fromRound: v.entries[i - 1].roundNumber, toRound: v.entries[i].roundNumber }
      }
    }
  }
  if (!best) return null
  const magnitude = Math.abs(best.delta)
  if (magnitude === 0) return null // no genuine swing at all — nothing to report
  return {
    category, kind, scope: 'individual', title, definition,
    playerIds: [best.playerId], playerNames: [best.playerName],
    roundNumber: best.toRound,
    statValue: magnitude, statLine: `${verb} ${magnitude} pts, Round ${best.fromRound} → Round ${best.toRound}`,
    significance: 700 + magnitude,
  }
}

function pickToughestHoleVictim(playerIndex: Map<string, { playerName: string; entries: PlayerEntries }>): EventHighlight | null {
  // Worst single-hole gross score anyone posted anywhere in the event —
  // "toughest hole victim." Ties (same worst score) become joint
  // sufferers, never an arbitrary singling-out.
  let worstScore = -Infinity
  let candidates: { playerId: string; playerName: string; roundId: string; roundNumber: number; holeNumber: number; gross: number; par: number }[] = []
  for (const [playerId, v] of playerIndex) {
    for (const e of v.entries) {
      for (const h of e.player.holes) {
        if (h.grossScore > worstScore) {
          worstScore = h.grossScore
          candidates = [{ playerId, playerName: v.playerName, roundId: e.roundId, roundNumber: e.roundNumber, holeNumber: h.holeNumber, gross: h.grossScore, par: h.par }]
        } else if (h.grossScore === worstScore) {
          candidates.push({ playerId, playerName: v.playerName, roundId: e.roundId, roundNumber: e.roundNumber, holeNumber: h.holeNumber, gross: h.grossScore, par: h.par })
        }
      }
    }
  }
  // A worst score at or below par isn't a "toughest hole victim" story
  // — only genuinely bad holes qualify (matching the round-level
  // engine's own "genuinely bad" bar).
  if (candidates.length === 0 || worstScore - candidates[0].par < 3) return null
  const first = candidates[0]
  return {
    category: 'toughest_hole_victim', kind: 'breaker', scope: 'individual', title: 'Toughest Hole Victim',
    definition: 'The single worst hole anyone posted all event.',
    playerIds: candidates.map(c => c.playerId), playerNames: candidates.map(c => c.playerName),
    roundId: first.roundId, roundNumber: first.roundNumber, holeNumber: first.holeNumber,
    statValue: worstScore, statLine: `${worstScore} on Hole ${first.holeNumber} (Round ${first.roundNumber})`,
    significance: 800,
  }
}

/**
 * "Best group/team performance if team/group data exists" — only ever
 * runs when at least one round actually has real group identity
 * (groupId non-null) and more than one group to compare; a trip that
 * never used groups correctly produces no candidate rather than an
 * invented one.
 */
function pickBestGroupPerformance(rounds: EventRoundData[]): EventHighlight | null {
  const groupTotals = new Map<string, { groupName: string; total: number; roundsCounted: number }>()
  for (const round of rounds) {
    const byGroup = new Map<string, PlayerRoundData[]>()
    for (const p of completedPlayers(round)) {
      if (!p.groupId) continue
      const arr = byGroup.get(p.groupId) ?? []
      arr.push(p)
      byGroup.set(p.groupId, arr)
    }
    for (const [groupId, members] of byGroup) {
      if (members.length < 2) continue // a "group" of one isn't a team result
      const roundTotal = members.reduce((s, m) => s + sumPts(m.holes), 0) / members.length // average per member, so group size doesn't skew it
      const existing = groupTotals.get(groupId)
      if (existing) { existing.total += roundTotal; existing.roundsCounted += 1 }
      else groupTotals.set(groupId, { groupName: members[0].groupName, total: roundTotal, roundsCounted: 1 })
    }
  }
  if (groupTotals.size < 2) return null // nothing to compare a "best" against
  const sorted = [...groupTotals.entries()].sort((a, b) => b[1].total - a[1].total)
  const [bestGroupId, best] = sorted[0]
  return {
    category: 'best_group', kind: 'maker', scope: 'group', title: 'Strongest Group',
    definition: 'The group with the best average points per member across the rounds they played together.',
    playerIds: [], playerNames: [], groupId: bestGroupId, groupName: best.groupName,
    statValue: Math.round(best.total / best.roundsCounted),
    statLine: `${Math.round(best.total / best.roundsCounted)} avg pts/member across ${best.roundsCounted} round${best.roundsCounted === 1 ? '' : 's'}`,
    significance: 600,
  }
}

function pickWorstGroupStretch(rounds: EventRoundData[]): EventHighlight | null {
  // Same shape as pickBestGroupPerformance, inverted — the group with
  // the worst average, only when there's a genuine field to compare
  // against.
  const groupTotals = new Map<string, { groupName: string; total: number; roundsCounted: number }>()
  for (const round of rounds) {
    const byGroup = new Map<string, PlayerRoundData[]>()
    for (const p of completedPlayers(round)) {
      if (!p.groupId) continue
      const arr = byGroup.get(p.groupId) ?? []
      arr.push(p)
      byGroup.set(p.groupId, arr)
    }
    for (const [groupId, members] of byGroup) {
      if (members.length < 2) continue
      const roundTotal = members.reduce((s, m) => s + sumPts(m.holes), 0) / members.length
      const existing = groupTotals.get(groupId)
      if (existing) { existing.total += roundTotal; existing.roundsCounted += 1 }
      else groupTotals.set(groupId, { groupName: members[0].groupName, total: roundTotal, roundsCounted: 1 })
    }
  }
  if (groupTotals.size < 2) return null
  const sorted = [...groupTotals.entries()].sort((a, b) => a[1].total - b[1].total)
  const [worstGroupId, worst] = sorted[0]
  return {
    category: 'worst_group_stretch', kind: 'breaker', scope: 'group', title: 'Toughest Stretch',
    definition: 'The group with the toughest average points per member across the rounds they played together.',
    playerIds: [], playerNames: [], groupId: worstGroupId, groupName: worst.groupName,
    statValue: Math.round(worst.total / worst.roundsCounted),
    statLine: `${Math.round(worst.total / worst.roundsCounted)} avg pts/member across ${worst.roundsCounted} round${worst.roundsCounted === 1 ? '' : 's'}`,
    significance: 500,
  }
}

/**
 * Release 2, item 6 — the "3-5 strongest story beats" selection for one
 * player's My Golf Event Story. Filters the SAME generated event
 * highlights down to ones this player is actually part of — never a
 * second analysis pass. If this player has fewer than the cap worth of
 * qualifying highlights, all of them are returned (never padded with
 * anything invented).
 */
export function selectPlayerEventStory(
  highlights: { makers: EventHighlight[]; breakers: EventHighlight[] },
  playerId: string, maxBeats = 5,
): EventHighlight[] {
  const mine = [...highlights.makers, ...highlights.breakers]
    .filter(h => h.playerIds.includes(playerId))
    .sort((a, b) => b.significance - a.significance)
  return mine.slice(0, maxBeats)
}

export type { PlayerRoundData, PlayerHoleResult }
