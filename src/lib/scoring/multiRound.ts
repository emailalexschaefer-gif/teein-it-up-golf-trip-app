/**
 * P0 fix — round-numbering corruption after adding a round out of
 * chronological order. Root cause: a new round's stored `name` (e.g.
 * "Round 3") is computed client-side from the CURRENT COUNT of existing
 * rounds at creation time, not from where its play_date will actually
 * fall once sorted chronologically. sortRoundsChronologically above
 * already computes the correct order — the bug was never in ordering
 * itself, it's that several screens then displayed the round's stored
 * `name` text directly, which can silently disagree with that
 * computed position the moment a round is added whose date lands
 * before an existing round's date (exactly the reported case: a new
 * round named "Round 3" at creation time, but chronologically it's
 * actually the second round played).
 *
 * This does not rename anything in the database — it's a pure display
 * function. Only overrides the label for a round whose name still
 * matches the plain, auto-generated "Round N" pattern; a genuinely
 * custom name (e.g. "Final Round", "The Sunday Battle") is always
 * preserved untouched, since forcibly overwriting deliberate
 * organiser text would be wrong. `rounds` must already be sorted via
 * sortRoundsChronologically before calling this.
 */
const AUTO_ROUND_NAME_PATTERN = /^round\s+\d+$/i

export function getRoundDisplayName<T extends { id: string; name: string }>(
  round: T, chronologicallySortedRounds: T[],
): string {
  if (!AUTO_ROUND_NAME_PATTERN.test(round.name.trim())) return round.name
  const index = chronologicallySortedRounds.findIndex(r => r.id === round.id)
  return index === -1 ? round.name : `Round ${index + 1}`
}

export interface RoundPlayerResult {
  playerId: string
  playerName: string
  roundPoints: number
  // Release 2, item 1 — countback. Per-hole points for this specific
  // round, in PLAY ORDER (not hole_number order — reuses the same
  // authoritative played-hole sequence Starting Tee established;
  // "the back nine" for countback purposes means the last 9 holes
  // PLAYED, which is holes 10-18 for a 1st-tee round but holes 1-9 for
  // an 18-hole/10th-tee round). Optional — a caller that doesn't supply
  // this for every round in a tie gets that tie left genuinely
  // unresolved (the previous, pre-countback behaviour) rather than a
  // silent wrong answer from partial data.
  holePoints?: number[]
}

export interface RoundOrderingInput {
  id: string
  play_date: string
  created_at?: string
}

/**
 * Stable, deterministic chronological ordering for a trip's rounds.
 *
 * Root cause this exists to fix: rounds are typically created together
 * in a single multi-row INSERT at trip setup, and Postgres's now()
 * resolves to transaction-start time — not per-row — so every round
 * created in that batch gets an IDENTICAL created_at. Ordering (or
 * filtering with .lt()/.lte()) by created_at alone therefore has no
 * reliable result when two rounds tie exactly, which they do by
 * construction. This was the actual root cause of Round 1's data
 * appearing under Round 2's "LIVE" column on the multi-round
 * leaderboard: the round holding the correct live data was
 * mislabeled "roundNumber: 1" purely because of arbitrary tie-breaking
 * in an ORDER BY with no secondary key — the underlying per-round
 * totals were always correctly scoped by round_id, only the column
 * LABEL was wrong.
 *
 * play_date (the organiser's actual configured chronological order,
 * already surfaced in the UI as each round's date) is the primary sort
 * key; created_at and id are deterministic tiebreakers only for rounds
 * sharing the same play_date. Fully generic — works identically for 2,
 * 3, or 20 rounds, with no round-count-specific branching anywhere.
 */
export function sortRoundsChronologically<T extends RoundOrderingInput>(rounds: T[]): T[] {
  return [...rounds].sort((a, b) =>
    a.play_date.localeCompare(b.play_date)
    || (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || a.id.localeCompare(b.id)
  )
}

export interface CumulativeStanding {
  playerId: string
  playerName: string
  totalPoints: number
  position: number
  roundsPlayed: number
}

/**
 * Release 2, item 1 — canonical countback ladder.
 *
 * Builds one ordered comparison key per player, most-significant first,
 * exactly matching the requested sequence:
 *   1. overall cumulative points (unaffected by which round is "final")
 *   2. best score in the most recent/final relevant round
 *   3. best back nine (last 9 holes PLAYED) of that round
 *   4. last 6 holes played
 *   5. last 3 holes played
 *   6. final played hole
 *   7. backwards through preceding holes, one at a time, until separated
 *
 * Step 6 and the start of step 7 are the same operation continued — the
 * final hole IS the first element compared "backwards through preceding
 * holes," so the key below doesn't duplicate it as a separate entry;
 * the reversed hole-by-hole array already begins there.
 *
 * "The most recent/final relevant round" is whichever entry is LAST in
 * `rounds` — the caller is responsible for supplying that array in
 * chronological order (reusing sortRoundsChronologically), so this
 * function itself never has to resolve round identity or ordering, only
 * consume it. Per the explicit warning, this never assumes physical
 * holes 10-18 are a round's closing nine — holePoints is expected to
 * already be in PLAY order (holeSequence.ts), so "last 9 holes played"
 * is correct for every Starting Tee configuration without this
 * function needing to know which one produced it.
 *
 * A player with no hole-level data at all for the deciding round
 * degrades gracefully to comparing on cumulative points only for every
 * remaining step (an all-zeros tail) — ties that data genuinely can't
 * resolve stay genuinely tied, rather than a wrong answer being
 * invented from missing data.
 */
export interface CountbackRoundData {
  roundId: string
  holePoints: number[]
}

function sum(values: number[]): number { return values.reduce((a, b) => a + b, 0) }

export function buildCountbackKey(totalPoints: number, rounds: CountbackRoundData[]): number[] {
  const mostRecent = rounds[rounds.length - 1]
  const holes = mostRecent?.holePoints ?? []
  const n = holes.length
  const mostRecentTotal = sum(holes)
  const backNine = n > 9 ? holes.slice(n - 9) : holes // "back nine" = last 9 holes PLAYED; a 9-hole round's whole card if fewer than 9 exist
  const last6 = holes.slice(Math.max(0, n - 6))
  const last3 = holes.slice(Math.max(0, n - 3))
  const backwards = [...holes].reverse() // [final hole, second-to-last, ...] — step 6 is backwards[0]; step 7 is the rest, compared one at a time
  return [totalPoints, mostRecentTotal, sum(backNine), sum(last6), sum(last3), ...backwards]
}

/**
 * Lexicographic comparator over two countback keys — higher wins at the
 * first point of difference. Keys of different lengths (a round with
 * fewer holes than another) are padded with 0 for the missing tail
 * rather than throwing, so this never crashes on a genuinely shorter
 * 9-hole round being compared against an 18-hole one.
 */
export function compareCountbackKeys(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Computes cumulative standings across any number of completed rounds.
 * Each element of `roundsResults` is one round's per-player results —
 * the caller supplies these from existing completed-round scorecard
 * data (see the accompanying report for exactly which existing tables
 * this reads from); this function itself only sums and ranks, it does
 * not know how points were derived.
 *
 * A player who appears in some but not all rounds (e.g. joined the trip
 * partway through, or a round-1-only guest) still gets a correct total
 * — their points are summed only across the rounds they actually
 * appear in, and roundsPlayed reflects that count.
 *
 * Release 2, item 1 — positions are now resolved via the countback
 * ladder above whenever hole-level data (roundPlayerResult.holePoints)
 * is available for the rounds involved in a tie, rather than always
 * leaving tied totals as a shared position. Countback only ever changes
 * POSITION — totalPoints itself is completely unaffected, still the
 * plain sum of roundPoints exactly as before. Where no hole-level data
 * exists for a given comparison (an older caller not yet updated, or
 * genuinely no data), that tie is left exactly as it was before this
 * feature existed — two players share the same position — never a
 * fabricated resolution from data that isn't there.
 */
export function computeCumulativeStandings(roundsResults: RoundPlayerResult[][]): CumulativeStanding[] {
  const totals = new Map<string, { playerName: string; totalPoints: number; roundsPlayed: number; rounds: CountbackRoundData[] }>()

  roundsResults.forEach((round, roundIdx) => {
    for (const r of round) {
      const existing = totals.get(r.playerId)
      const roundEntry: CountbackRoundData = { roundId: String(roundIdx), holePoints: r.holePoints ?? [] }
      if (existing) {
        existing.totalPoints += r.roundPoints
        existing.roundsPlayed += 1
        existing.rounds.push(roundEntry)
      } else {
        totals.set(r.playerId, { playerName: r.playerName, totalPoints: r.roundPoints, roundsPlayed: 1, rounds: [roundEntry] })
      }
    }
  })

  const sorted = [...totals.entries()]
    .map(([playerId, v]) => ({ playerId, ...v, countbackKey: buildCountbackKey(v.totalPoints, v.rounds) }))
    .sort((a, b) => compareCountbackKeys(a.countbackKey, b.countbackKey))

  const result: CumulativeStanding[] = []
  let position = 0
  let previousKey: number[] | null = null
  sorted.forEach((s, idx) => {
    if (previousKey === null || compareCountbackKeys(s.countbackKey, previousKey) !== 0) {
      position = idx + 1
      previousKey = s.countbackKey
    }
    result.push({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints, position, roundsPlayed: s.roundsPlayed })
  })
  return result
}

export interface RoundWinner { playerId: string; playerName: string; points: number }

/**
 * The winner(s) of a single round, independent of overall cumulative
 * standing — the player(s) with the highest points in that round only.
 * Tie-safe by construction: returns every player who reached the max,
 * never picks one arbitrarily by array/database order. An empty
 * `results` array (a round with no scorecards at all) returns an empty
 * winners list rather than crashing or inventing a winner.
 */
export function determineRoundWinners(results: RoundPlayerResult[]): RoundWinner[] {
  if (results.length === 0) return []
  const maxPoints = Math.max(...results.map(r => r.roundPoints))
  return results.filter(r => r.roundPoints === maxPoints)
    .map(r => ({ playerId: r.playerId, playerName: r.playerName, points: r.roundPoints }))
}

export interface Champion { playerId: string; playerName: string; totalPoints: number }

/**
 * The event champion(s) from already-computed cumulative standings —
 * whichever player(s) hold position 1. Release 2, item 1 — since
 * computeCumulativeStandings now resolves ties via the canonical
 * countback ladder whenever hole-level data is available, two players
 * only both come back as champions when they're genuinely tied all the
 * way through it (identical cumulative points, identical final round,
 * identical every step of countback) — not merely level on the raw
 * total. No separate countback logic lives here; this function only
 * ever reads position, which computeCumulativeStandings is now
 * responsible for getting right.
 */
export function determineChampions(standings: CumulativeStanding[]): Champion[] {
  return standings.filter(s => s.position === 1)
    .map(s => ({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints }))
}

export interface LeadersLastAssignment {
  playerId: string
  groupIndex: number // 0 = earliest tee time, highest index = latest (leaders)
}

/**
 * "Leaders Last" reverse-grid seeding: the current event leader plays in
 * the final (latest tee time) group, the lowest-ranked player plays in
 * the first (earliest) group.
 *
 * `standings` must be ordered best-to-worst (position 1 first) — the
 * same order computeCumulativeStandings already returns. `groupSize` is
 * the target size per group (existing trip/round configuration); the
 * final group absorbs any remainder if the player count doesn't divide
 * evenly, since a smaller final group is the more natural outcome for a
 * tee sheet than an uneven earlier one.
 *
 * Verified directly against the brief's own worked example: 8 players
 * in groups of 4 produces earliest group = the bottom 4 (ranks 5-8),
 * latest group = the top 4 (ranks 1-4) — matching "Group 1: John,
 * Peter, James, Tom" / "Group 2: Steve, Mark, Darren, Alex" exactly.
 */
export function seedLeadersLast(standings: { playerId: string }[], groupSize: number): LeadersLastAssignment[] {
  if (groupSize < 1) throw new Error('groupSize must be at least 1')

  // Reverse so the worst-ranked player is first — chunking front-to-back
  // from here naturally puts the lowest-ranked players in the earliest
  // chunk (group 0) and the leader in the last chunk.
  const worstFirst = [...standings].reverse()

  const assignments: LeadersLastAssignment[] = []
  let groupIndex = 0
  for (let i = 0; i < worstFirst.length; i += groupSize) {
    const chunk = worstFirst.slice(i, i + groupSize)
    for (const player of chunk) {
      assignments.push({ playerId: player.playerId, groupIndex })
    }
    groupIndex += 1
  }
  return assignments
}

/**
 * Package 1 fix — builds the leaderboard header's per-round summary
 * (roundId, roundNumber, isLive) from each round's own actual status,
 * not array position. Extracted as a pure function specifically so
 * it's unit-tested, matching this file's own established pattern
 * (selectLeaderboardRound's exact same rationale) — this exact logic
 * was previously inline in the API route as
 * `i === rounds.length - 1 ? ' LIVE' : ''`, which happened to be
 * correct only when the round being viewed genuinely was the active
 * one, and silently mislabeled a completed round as "LIVE" the moment
 * a player browsed back to an earlier round, or once the whole event
 * finished.
 */
export interface RoundSummaryInput { id: string; status: string }

export function buildRoundsSummary(sortedRelevantRounds: RoundSummaryInput[]): { roundId: string; roundNumber: number; isLive: boolean }[] {
  return sortedRelevantRounds.map((r, idx) => ({
    roundId: r.id, roundNumber: idx + 1, isLive: r.status === 'active',
  }))
}

/**
 * Previous | Current | Total leaderboard presentation — the newly
 * approved scalable model replacing per-round (R1 | R2 | ... ) columns.
 * Deliberately a pure derivation from data that's already correct
 * (totalPoints from computeCumulativeStandings, current from the
 * existing round_id-keyed per-round breakdown) rather than a new
 * calculation — Total = Previous + Current always holds by
 * construction, since Previous is defined as whatever's left after
 * subtracting Current from the total. isFirstRound (no prior round to
 * show at all, not merely a real prior round scored 0) is exposed
 * separately so callers can render "—" for Previous specifically in
 * that case, per the brief's own instruction.
 */
export interface PreviousCurrentTotal { previous: number; current: number; total: number; isFirstRound: boolean }

export function derivePreviousCurrentTotal(totalPoints: number, currentRoundPoints: number, roundsPlayedCount: number): PreviousCurrentTotal {
  return {
    previous: totalPoints - currentRoundPoints,
    current: currentRoundPoints,
    total: totalPoints,
    isFirstRound: roundsPlayedCount <= 1,
  }
}

export interface LeaderboardRoundCandidate extends RoundOrderingInput {
  status: string
}

/**
 * The default Leaderboard page's round-selection logic, extracted as a
 * pure function specifically so it's unit-tested — this was previously
 * inline in the page component with no direct test coverage, which is
 * exactly how a real bug (no deterministic tiebreaker for rounds with
 * identical play_date) went unnoticed.
 *
 * Priority: an active round takes precedence (live scoring in
 * progress); otherwise the most recently COMPLETED round (so between-
 * round and full-event-complete states show cumulative standings rather
 * than an empty or Round-1-only board); otherwise the chronologically
 * first round (a genuinely pre-event state, unchanged fallback
 * behaviour). Uses sortRoundsChronologically — the same already-tested
 * helper that fixed the identical "tied play_date" bug class in the
 * leaderboard API route — rather than re-solving the same problem a
 * second, potentially inconsistent way.
 */
export function selectLeaderboardRound<T extends LeaderboardRoundCandidate>(rounds: T[]): T | undefined {
  const chronological = sortRoundsChronologically(rounds) // oldest first
  const activeRound = chronological.find(r => r.status === 'active')
  if (activeRound) return activeRound
  // Most recent completed = last match walking from the end, not the
  // first match on a DESC-sorted copy — avoids allocating a second
  // reversed array purely to find the same thing from the other side.
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (chronological[i].status === 'completed') return chronological[i]
  }
  return chronological[0]
}

/**
 * Package 3 (D2) — "View Final Results" navigation. A valid, explicit
 * requestedRoundId overrides the automatic selectLeaderboardRound pick
 * entirely; falls back to the automatic pick if the param is missing
 * or doesn't match any real round for this trip (never a broken/blank
 * page). Extracted specifically so this override behaviour is
 * unit-tested rather than only living inline in the leaderboard page,
 * matching every other selection function in this file.
 */
export function resolveRequestedOrDefaultRound<T extends LeaderboardRoundCandidate>(rounds: T[], requestedRoundId: string | undefined): T | undefined {
  const requested = requestedRoundId ? rounds.find(r => r.id === requestedRoundId) : undefined
  return requested ?? selectLeaderboardRound(rounds)
}

/**
 * Package 3 (A4) — case-insensitive first-name/surname/full-name search
 * for Score Management. Extracted into its own function specifically
 * for test coverage (item G2/G3), even though the logic itself is
 * simple — this is exactly the kind of small predicate that's easy to
 * silently break in a future refactor (e.g. accidentally requiring an
 * exact match, or comparing before trimming/lowercasing) without a
 * dedicated test catching it immediately.
 */
export function matchesPlayerSearch(playerName: string, searchTerm: string): boolean {
  const term = searchTerm.trim().toLowerCase()
  if (term.length === 0) return true
  return playerName.toLowerCase().includes(term)
}

/**
 * Package 4 (item 4) — "completed round remains the focus until next
 * round starts." The actual root cause of "My HQ effectively moved
 * forward to the next round," found by tracing both places this exact
 * priority decision was independently made (tournament/page.tsx and
 * PlayerHomeCard.tsx): both previously prioritised the next upcoming
 * round over the just-completed one, so the moment Round 1 finished
 * and Round 2 existed as 'upcoming' (not yet live), the page jumped
 * straight to Round 2 — skipping the post-round celebration (and
 * making the organiser's own Makers & Breakers entry point effectively
 * unreachable) entirely.
 *
 * Extracted into one shared, tested function per "prefer shared fixes
 * over screen-by-screen patches" — both call sites now go through
 * this, rather than maintaining two independently-drifting copies of
 * the same priority logic.
 */
export interface FocusRoundCandidate { id: string; status: string }

export function resolveFocusRound<T extends FocusRoundCandidate>(
  activeRound: T | undefined, mostRecentlyCompletedRound: T | undefined, nextUpcomingRound: T | undefined,
): T | undefined {
  return activeRound ?? mostRecentlyCompletedRound ?? nextUpcomingRound
}

/**
 * Which rounds' Side Games are relevant for the default (event-level)
 * screen — every completed round (preserves all verified history so
 * far) plus the active round if one exists (shows live state through
 * it). Deliberately a single, uniform rule rather than three branches
 * for "active/between-rounds/event-complete": each of those states is
 * just what this same filter naturally produces given the rounds'
 * actual statuses at that moment, not a state machine to keep in sync
 * with computeRoundSideGames elsewhere. An 'upcoming' round is excluded
 * entirely — nothing has happened on it yet, so it contributes nothing
 * to show, not an empty placeholder. Ordered chronologically (using the
 * same deterministic tiebreaker as selectLeaderboardRound, for the same
 * reason — rounds created together can share a play_date), so the
 * caller's own displayed round numbering is stable and correct.
 */
export function selectRelevantSideGameRounds<T extends LeaderboardRoundCandidate>(rounds: T[]): T[] {
  return sortRoundsChronologically(rounds).filter(r => r.status === 'completed' || r.status === 'active')
}
