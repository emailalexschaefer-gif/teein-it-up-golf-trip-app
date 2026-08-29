/**
 * Makers & Breakers V1 — end-of-round highlight engine.
 *
 * Deliberately reads only already-persisted score_entries.stableford_pts
 * values (the DB trigger is the single source of truth for that number,
 * per stableford.ts's own header comment) — this module never
 * recalculates Stableford points itself, only aggregates and compares
 * them. Everything here is a pure function over already-known data:
 * no AI generation, no non-determinism, matching the explicit
 * "deterministic and factual" requirement.
 */

export interface PlayerHoleResult {
  holeNumber: number
  stablefordPts: number
  grossScore: number
  par: number
}

export interface PlayerRoundData {
  playerId: string
  playerName: string
  /** 1 for a standard round; the group's actual shotgun starting hole otherwise. */
  startingHole: number
  /** In hole-number order (1..totalHoles) — reordered into played sequence internally. */
  holes: PlayerHoleResult[]
  // Field-test extension — round-specific group snapshot (scorecards.
  // group_id, set once at begin_round() and never mutated afterward),
  // per the non-negotiable "must use the round-specific group
  // assignment, not current mutable trip grouping" requirement. This
  // is the SAME snapshot mechanism multiRound.ts already relies on for
  // group identity elsewhere in this app — not a new concept.
  groupId: string | null
  groupName: string
}

export interface FieldRoundData {
  players: PlayerRoundData[]
  totalHoles: number // 9 or 18
  // Item 14 (Goose) — "only generate if the round actually contains a
  // Powerplay and the player qualifies." null/undefined means no
  // Powerplay hole exists for this round at all — Goose is skipped
  // entirely rather than guessing.
  powerplayHoleNumber?: number | null
}

export interface Highlight {
  category: string
  kind: 'maker' | 'breaker'
  // Field-test extension — the brief's four-category split
  // (individual_maker/group_maker/individual_breaker/group_breaker)
  // is exactly kind x scope; scope is the new axis, not a
  // reimplementation of kind.
  scope: 'individual' | 'group'
  icon: string
  title: string
  playerId: string
  playerName: string
  statLine: string
  // P0 field-test fix — the short, reusable, title-only definition
  // ("High risk. High reward. Anything could happen.") shown once per
  // archetype regardless of who qualified — see ARCHETYPE_DEFINITIONS
  // below. Optional so existing callers/tests constructing a Highlight
  // by hand don't all need updating; generateMakersAndBreakers always
  // populates it for real output.
  definition?: string
  caption?: string
  // Explainability — "every generated candidate should carry
  // structured evidence... don't generate opaque strings that can't
  // be traced back to data." significance is the ranking key within a
  // category (higher = more noteworthy); groupId/groupName populated
  // only for scope='group' highlights.
  significance: number
  groupId?: string | null
  groupName?: string | null
}

/**
 * Reorders a player's holes (given in hole-number order) into the order
 * they actually played them — starting at startingHole and wrapping
 * around through the actual set of hole numbers this round has (not
 * assumed to be a contiguous 1..totalHoles run — a back-nine round's
 * holes are physically 10-18, not 1-9). For a standard 1st-tee round
 * this is a no-op; the reorder does real work for both Shotgun starts
 * and Starting Tee (holeSequence.ts) rounds, without needing to know
 * which of the two produced player.startingHole — both are just "which
 * physical hole did this player's sequence begin on," and this
 * function's generalized wraparound-over-the-actual-hole-set logic
 * produces the correct result either way, including the previously-
 * broken case (a 9-hole/10th-tee round, holes 10-18 only): the naive
 * `((startingHole - 1 + i) % totalHoles) + 1` version this replaced
 * assumed hole numbers ran 1..totalHoles, so for a back-nine round it
 * generated lookups for holes 1-9 that simply don't exist in that
 * player's actual holes (all physically 10-18) — every hole silently
 * failed to match and the played sequence came back empty. Verified
 * mathematically identical to the previous formula for every case that
 * already worked (standard round, Shotgun on a full 18): when hole
 * numbers ARE contiguous 1..totalHoles, indexing into the sorted set is
 * the same operation as the modulo arithmetic it replaces.
 *
 * This is the single place "played sequence" is computed — every
 * category below that needs opening/closing holes goes through this
 * function rather than reimplementing the wraparound logic.
 */
export function getPlayedSequence(player: PlayerRoundData, totalHoles: number): PlayerHoleResult[] {
  const byHoleNumber = new Map(player.holes.map(h => [h.holeNumber, h]))
  const sortedHoleNumbers = [...byHoleNumber.keys()].sort((a, b) => a - b)
  if (sortedHoleNumbers.length === 0) return []
  const startIdx = sortedHoleNumbers.indexOf(player.startingHole)
  const effectiveStartIdx = startIdx === -1 ? 0 : startIdx
  const n = sortedHoleNumbers.length
  const sequence: PlayerHoleResult[] = []
  for (let i = 0; i < Math.min(totalHoles, n); i++) {
    const holeNumber = sortedHoleNumbers[(effectiveStartIdx + i) % n]
    const hole = byHoleNumber.get(holeNumber)
    if (hole) sequence.push(hole)
  }
  return sequence
}

export function sumPts(holes: PlayerHoleResult[]): number {
  return holes.reduce((sum, h) => sum + h.stablefordPts, 0)
}

// Release 2, item 4 — exported so eventMakersBreakers.ts can reuse the
// exact same "did this player finish this round" definition, rather
// than a second, potentially-drifting copy of it.
export function hasCompleteRound(player: PlayerRoundData, totalHoles: number): boolean {
  return player.holes.length === totalHoles
}

// ── MAKERS ──────────────────────────────────────────────────────────────

export function findHotStart(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => {
      const seq = getPlayedSequence(p, field.totalHoles)
      return { player: p, pts: sumPts(seq.slice(0, 3)) }
    })
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.pts > a.pts ? b : a))
  // Qualification threshold — "The Heater"/Hot Start needs a genuinely
  // strong opening, not just whoever happened to be least bad. 3
  // holes at a decent points-per-hole rate.
  if (best.pts < 7) return null
  return {
    category: 'hot_start', kind: 'maker', scope: 'individual', icon: '🔥', title: 'Hot Start',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points from the opening 3 holes`,
    significance: best.pts,
  }
}

export function findBackNineKing(field: FieldRoundData): Highlight | null {
  // Explicitly 18-hole only — "do not invent misleading back nine data
  // on a 9-hole round" is a hard rule, not a preference, so this
  // returns null outright for anything else rather than approximating.
  if (field.totalHoles !== 18) return null
  const candidates = field.players
    .filter(p => hasCompleteRound(p, 18))
    .map(p => ({ player: p, pts: sumPts(p.holes.filter(h => h.holeNumber >= 10)) }))
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.pts > a.pts ? b : a))
  // 18-hole back nine — a meaningful points-per-hole threshold, not
  // just "whoever had the highest of a possibly-mediocre field."
  if (best.pts < 16) return null
  return {
    category: 'back_nine_king', kind: 'maker', scope: 'individual', icon: '👑', title: 'Back Nine King',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points coming home`,
    significance: best.pts,
  }
}

export function findFastFinish(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => {
      const seq = getPlayedSequence(p, field.totalHoles)
      return { player: p, pts: sumPts(seq.slice(-3)) }
    })
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.pts > a.pts ? b : a))
  if (best.pts < 7) return null
  return {
    category: 'fast_finish', kind: 'maker', scope: 'individual', icon: '🚀', title: 'Fast Finish',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points over the final 3`,
    significance: best.pts,
  }
}

export function findBirdieHunter(field: FieldRoundData): Highlight | null {
  // Birdie is a gross-scoring term (one under par on the hole), not a
  // handicap-adjusted one — matches the standard golf definition, not
  // the nett-based Stableford calculation used elsewhere.
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, birdies: p.holes.filter(h => h.grossScore === h.par - 1).length }))
    // Critical fix — "if the most birdies is only 1, Birdman should
    // normally NOT qualify." A mathematical winner is not the same as
    // a qualified candidate; this was previously `> 0`.
    .filter(c => c.birdies >= 2)
  if (candidates.length === 0) return null
  const maxBirdies = Math.max(...candidates.map(c => c.birdies))
  const best = candidates.find(c => c.birdies === maxBirdies)!
  return {
    category: 'birdie_hunter', kind: 'maker', scope: 'individual', icon: '🐦', title: 'Birdie Hunter',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.birdies} birdie${best.birdies === 1 ? '' : 's'}`,
    significance: best.birdies,
  }
}

export function findMrConsistent(field: FieldRoundData): Highlight | null {
  // Iceman — "consistently good, not consistently mediocre." Requires
  // BOTH a respectable total (candidates below the field median total
  // are excluded outright) AND the count metric below — mirrors the
  // brief's explicit "restrict candidates to players at/above a
  // minimum performance threshold; lowest qualifying volatility wins"
  // without inventing a full variance calculation this pass.
  const complete = field.players.filter(p => hasCompleteRound(p, field.totalHoles))
  if (complete.length === 0) return null
  const totals = complete.map(p => sumPts(p.holes)).sort((a, b) => a - b)
  const medianTotal = totals[Math.floor(totals.length / 2)]
  const candidates = complete
    .filter(p => sumPts(p.holes) >= medianTotal)
    .map(p => ({ player: p, count: p.holes.filter(h => h.stablefordPts >= 2).length }))
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.count > a.count ? b : a))
  if (best.count < Math.ceil(field.totalHoles * 0.6)) return null
  return {
    category: 'mr_consistent', kind: 'maker', scope: 'individual', icon: '🧊', title: 'Iceman',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.count} holes of 2 points or better`,
    significance: best.count,
  }
}

/**
 * Maverick — "the wildest scorecard of the round," deliberately built
 * as the near-opposite selection criteria to Iceman above: instead of
 * "consistently at or above a threshold," Maverick requires genuine
 * highs AND genuine lows on the SAME scorecard. Neither a player who
 * simply played badly all day (no highs) nor an unusually good,
 * uneventful round (no lows) can qualify — both halves of the pattern
 * are required, matching the explicit "must include both genuinely
 * good scoring events and genuinely bad scoring events" and "do NOT
 * give Maverick to somebody who simply played badly all day."
 * "Genuinely good" = 3+ Stableford points (better than a par-equivalent
 * score for most handicaps); "genuinely bad" = a wipe (0 points) —
 * reusing the exact same 0-point definition findWipeoutKing already
 * uses, not a second definition of "bad."
 */
export function findMaverick(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({
      player: p,
      highs: p.holes.filter(h => h.stablefordPts >= 3).length,
      lows: p.holes.filter(h => h.stablefordPts === 0).length,
    }))
    // Minimum 2 of each — a single great hole and a single wipe is
    // just an ordinary round; the pattern needs to be genuinely
    // repeated to read as "wild," not incidental.
    .filter(c => c.highs >= 2 && c.lows >= 2)
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => ((b.highs + b.lows) > (a.highs + a.lows) ? b : a))
  return {
    category: 'maverick', kind: 'breaker', scope: 'individual', icon: '🕶️', title: 'Maverick',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.highs} big holes, ${best.lows} wipes`,
    significance: best.highs + best.lows,
  }
}

export function findRoundPerformer(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, pts: sumPts(p.holes) }))
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.pts > a.pts ? b : a))
  return {
    category: 'round_performer', kind: 'maker', scope: 'individual', icon: '⭐', title: 'Round Performer',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} Stableford points`,
    significance: best.pts,
  }
}

/**
 * The Mailman — "always delivers." The brief's own item 6.1: "round
 * winner... normally a guaranteed Maker once the round has a valid
 * winner." Deliberately reuses the exact same "highest total"
 * computation findRoundPerformer already does — this IS the round
 * winner — but is framed as its own archetype with its own title/icon,
 * since "Round Performer" and "The Mailman" are presentationally
 * distinct even though the underlying winner calculation is identical.
 */
export function findMailman(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, pts: sumPts(p.holes) }))
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => b.pts - a.pts)
  const winner = sorted[0]
  const runnerUp = sorted[1]
  const margin = runnerUp ? winner.pts - runnerUp.pts : null
  return {
    category: 'mailman', kind: 'maker', scope: 'individual', icon: '📬', title: 'The Mailman',
    playerId: winner.player.playerId, playerName: winner.player.playerName,
    statLine: margin !== null
      ? `${winner.pts} points \u2014 the win by ${margin}`
      : `${winner.pts} points and the round win`,
    significance: winner.pts,
  }
}

// ── BREAKERS ────────────────────────────────────────────────────────────

export function findWipeoutKing(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, wipes: p.holes.filter(h => h.stablefordPts === 0).length }))
    // Critical fix — "if the highest number of wipes is only 1,
    // Wipeout should NOT qualify." Was previously `> 0`. 3+ for an
    // 18-hole round per the brief's own suggested minimum, scaled down
    // proportionally for 9 holes.
    .filter(c => c.wipes >= (field.totalHoles >= 18 ? 3 : 2))
  if (candidates.length === 0) return null
  const maxWipes = Math.max(...candidates.map(c => c.wipes))
  const best = candidates.find(c => c.wipes === maxWipes)!
  return {
    category: 'wipeout_king', kind: 'breaker', scope: 'individual', icon: '💥', title: 'Wipeout King',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.wipes} wipe${best.wipes === 1 ? '' : 's'} today`,
    significance: best.wipes,
  }
}

export function findColdStart(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => {
      const seq = getPlayedSequence(p, field.totalHoles)
      return { player: p, pts: sumPts(seq.slice(0, 3)) }
    })
  if (candidates.length === 0) return null
  const worst = candidates.reduce((a, b) => (b.pts < a.pts ? b : a))
  // A merely average opening isn't a "Cold Start" — this needs to be
  // genuinely poor, not just the least-good of a strong field.
  if (worst.pts > 3) return null
  return {
    category: 'cold_start', kind: 'breaker', scope: 'individual', icon: '🧊', title: 'Cold Start',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.pts} points from the opening 3`,
    significance: 10 - worst.pts,
  }
}

/** Minimum meaningful front/back split — arbitrary but reasoned: a
 * 1-2 point difference is normal round variance, not a "collapse." */
const COLLAPSE_MIN_THRESHOLD = 5

export function findTheCollapse(field: FieldRoundData): Highlight | null {
  if (field.totalHoles !== 18) return null // "front 9 vs back 9" has no clean definition on a 9-hole round
  const candidates = field.players
    .filter(p => hasCompleteRound(p, 18))
    .map(p => {
      const front = sumPts(p.holes.filter(h => h.holeNumber <= 9))
      const back = sumPts(p.holes.filter(h => h.holeNumber >= 10))
      return { player: p, front, back, drop: front - back }
    })
    .filter(c => c.drop >= COLLAPSE_MIN_THRESHOLD)
  if (candidates.length === 0) return null
  const worst = candidates.reduce((a, b) => (b.drop > a.drop ? b : a))
  return {
    category: 'the_collapse', kind: 'breaker', scope: 'individual', icon: '📉', title: 'The Meltdown',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.front} out. ${worst.back} home.`,
    significance: worst.drop,
  }
}

export function findRoughFinish(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => {
      const seq = getPlayedSequence(p, field.totalHoles)
      return { player: p, pts: sumPts(seq.slice(-3)) }
    })
  if (candidates.length === 0) return null
  const worst = candidates.reduce((a, b) => (b.pts < a.pts ? b : a))
  if (worst.pts > 3) return null
  return {
    category: 'rough_finish', kind: 'breaker', scope: 'individual', icon: '😬', title: 'Rough Finish',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.pts} points over the final 3`,
    significance: 10 - worst.pts,
  }
}

export function findHoleFromHell(field: FieldRoundData): Highlight | null {
  const completedPlayers = field.players.filter(p => hasCompleteRound(p, field.totalHoles))
  if (completedPlayers.length < 2) return null // "field average" needs at least a couple of data points to mean anything

  let best: { player: PlayerRoundData; holeNumber: number; fieldAvg: number } | null = null
  for (let holeNumber = 1; holeNumber <= field.totalHoles; holeNumber++) {
    const entriesOnHole = completedPlayers
      .map(p => p.holes.find(h => h.holeNumber === holeNumber))
      .filter((h): h is PlayerHoleResult => h != null)
    if (entriesOnHole.length < 2) continue
    const fieldAvg = sumPts(entriesOnHole) / entriesOnHole.length
    for (const p of completedPlayers) {
      const myHole = p.holes.find(h => h.holeNumber === holeNumber)
      if (!myHole || myHole.stablefordPts !== 0) continue
      // "highest-contrast example" — the gap between what the player
      // scored (0) and how well everyone else did on that same hole.
      const contrast = fieldAvg
      if (!best || contrast > best.fieldAvg) best = { player: p, holeNumber, fieldAvg }
    }
  }
  if (!best) return null
  return {
    category: 'hole_from_hell', kind: 'breaker', scope: 'individual', icon: '🕳️', title: 'Hole from Hell',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `Field average: ${best.fieldAvg.toFixed(1)} pts \u00b7 ${best.player.playerName.split(' ')[0]}: 0`,
    caption: `Everyone liked hole ${best.holeNumber}. ${best.player.playerName.split(' ')[0]} apparently didn't.`,
    significance: best.fieldAvg,
  }
}

/**
 * "One That Got Away" — requires reconstructing leaderboard position at
 * an earlier point in the round versus the final position. This IS
 * cleanly derivable from hole-by-hole cumulative totals without any new
 * schema (per the brief's own fallback instruction: "if cleanly
 * derivable, calculate it"): at any hole count N, each player's
 * cumulative total through N completed holes gives a rankable snapshot,
 * without needing a persisted "leaderboard position over time" table.
 */
export function findOneThatGotAway(field: FieldRoundData): Highlight | null {
  const completedPlayers = field.players.filter(p => hasCompleteRound(p, field.totalHoles))
  if (completedPlayers.length < 3) return null // "leaderboard position" only means something with a real field

  const snapshotHoles = Math.max(3, field.totalHoles - 4) // "approximately 3-6 holes remaining" -> snapshot with 3-6 to go, scaled sensibly for 9-hole rounds too
  function cumulativeThrough(p: PlayerRoundData, n: number): number {
    const seq = getPlayedSequence(p, field.totalHoles).slice(0, n)
    return sumPts(seq)
  }
  function rank(scores: { playerId: string; total: number }[], playerId: string): number {
    const sorted = [...scores].sort((a, b) => b.total - a.total)
    return sorted.findIndex(s => s.playerId === playerId) + 1
  }

  const earlyScores = completedPlayers.map(p => ({ playerId: p.playerId, total: cumulativeThrough(p, snapshotHoles) }))
  const finalScores = completedPlayers.map(p => ({ playerId: p.playerId, total: sumPts(p.holes) }))

  let worst: { player: PlayerRoundData; earlyPos: number; finalPos: number; drop: number } | null = null
  for (const p of completedPlayers) {
    const earlyPos = rank(earlyScores, p.playerId)
    const finalPos = rank(finalScores, p.playerId)
    const drop = finalPos - earlyPos
    if (drop > 0 && (!worst || drop > worst.drop)) worst = { player: p, earlyPos, finalPos, drop }
  }
  if (!worst || worst.drop < 2) return null // a one-place slide isn't "the one that got away"

  const positionLabel = (pos: number) => pos === 1 ? 'Leading' : `${pos}${ordinalSuffix(pos)}`
  return {
    category: 'one_that_got_away', kind: 'breaker', scope: 'individual', icon: '💔', title: 'One That Got Away',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${positionLabel(worst.earlyPos)} after ${snapshotHoles}. Finished ${worst.finalPos === 1 ? '1st' : `${worst.finalPos}${ordinalSuffix(worst.finalPos)}`}.`,
    significance: worst.drop,
  }
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'st'
  if (n % 10 === 2 && n % 100 !== 12) return 'nd'
  if (n % 10 === 3 && n % 100 !== 13) return 'rd'
  return 'th'
}

/**
 * Goose — "player wipes the designated Powerplay hole." Only ever
 * generated when the round genuinely has a Powerplay configured
 * (powerplayHoleNumber set) — per the explicit "only generate if the
 * round actually contains a Powerplay" instruction, this is a hard
 * gate, not a fallback/default.
 */
export function findGoose(field: FieldRoundData): Highlight | null {
  if (field.powerplayHoleNumber == null) return null
  const playerForHole = field.players.find(p =>
    p.holes.some(h => h.holeNumber === field.powerplayHoleNumber && h.stablefordPts === 0)
  )
  if (!playerForHole) return null
  return {
    category: 'goose', kind: 'breaker', scope: 'individual', icon: '🪿', title: 'Goose',
    playerId: playerForHole.playerId, playerName: playerForHole.playerName,
    statLine: 'Powerplay activated. Zero points.',
    caption: 'Talk to me, Goose.',
    significance: 100, // a Powerplay wipe is inherently notable — always ranks near the top of its category when it qualifies at all
  }
}

// ── GROUP ARCHETYPES ────────────────────────────────────────────────────
// Field-test extension — the brief's Group Maker/Breaker categories
// were entirely absent from the prior implementation. Groups are
// derived from field.players[].groupId (the round-specific snapshot,
// never mutable current trip grouping — see PlayerRoundData's own
// comment on this field) grouped in-memory here, not from a separate
// query. Per-player averages are used throughout, not raw group
// totals, so different group sizes are comparable — matching the
// explicit "prefer per-player averages... rather than raw totals"
// instruction.

interface GroupBucket { groupId: string; groupName: string; members: PlayerRoundData[] }

function bucketByGroup(field: FieldRoundData): GroupBucket[] {
  const complete = field.players.filter(p => hasCompleteRound(p, field.totalHoles) && p.groupId)
  const byGroup = new Map<string, PlayerRoundData[]>()
  for (const p of complete) {
    const key = p.groupId as string
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(p)
  }
  return [...byGroup.entries()]
    .filter(([, members]) => members.length >= 2) // a "group" of 1 has no group dynamic to report on
    .map(([groupId, members]) => ({ groupId, groupName: members[0].groupName || 'Group', members }))
}

function groupAverage(members: PlayerRoundData[], holeFilter?: (h: PlayerHoleResult) => boolean): number {
  const totals = members.map(m => sumPts(holeFilter ? m.holes.filter(holeFilter) : m.holes))
  return totals.reduce((s, t) => s + t, 0) / members.length
}

export function findHotGroup(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => ({ group: g, avg: groupAverage(g.members) }))
  const best = scored.reduce((a, b) => (b.avg > a.avg ? b : a))
  // A genuinely strong group performance, not just whichever group
  // happened to edge out the others in an otherwise unremarkable field.
  if (best.avg < 25) return null
  return {
    category: 'hot_group', kind: 'maker', scope: 'group', icon: '🔥', title: 'The Hot Group',
    playerId: '', playerName: '',
    groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `${best.avg.toFixed(1)} pt player average`,
    significance: best.avg,
  }
}

export function findBlackHoleGroup(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  let worst: { group: GroupBucket; holeNumber: number; combined: number; memberCount: number } | null = null
  for (const g of groups) {
    for (let holeNumber = 1; holeNumber <= field.totalHoles; holeNumber++) {
      const entries = g.members.map(m => m.holes.find(h => h.holeNumber === holeNumber)).filter((h): h is PlayerHoleResult => h != null)
      if (entries.length !== g.members.length) continue // only a genuinely complete group-hole result counts
      const combined = sumPts(entries)
      // Normalised threshold — "require a threshold so a merely
      // mediocre hole doesn't qualify," scaled by group size (a
      // 4-player group scoring 3 combined is far worse than a 2-player
      // group scoring 3 combined).
      const normalisedThreshold = g.members.length * 1.5
      if (combined > normalisedThreshold) continue
      if (!worst || combined / g.members.length < worst.combined / worst.memberCount) {
        worst = { group: g, holeNumber, combined, memberCount: g.members.length }
      }
    }
  }
  if (!worst) return null
  return {
    category: 'black_hole_group', kind: 'breaker', scope: 'group', icon: '🕳️', title: 'The Black Hole',
    playerId: '', playerName: '',
    groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `Hole ${worst.holeNumber} \u00b7 ${worst.combined} combined points`,
    caption: 'That one hurt.',
    significance: 20 - worst.combined,
  }
}

/**
 * Course Report — the deterministic opening summary shown BEFORE
 * Makers & Breakers proper. Not one of the 24 archetypes — the
 * standard, always-shown opener, per the brief's own item 2.
 */
export interface CourseReport {
  fieldAverage: number
  easiestHole: { holeNumber: number; par: number; average: number } | null
  hardestHole: { holeNumber: number; par: number; average: number } | null
  // Post-round Round Snapshot extension — the canonical source for
  // Round Snapshot's five stats (item 2). Extended here, not
  // duplicated in a second calculation, per the explicit "reuse this
  // existing calculation wherever practical... extend the canonical
  // result cleanly rather than duplicating calculations elsewhere."
  roundWinner: { playerId: string; playerName: string; totalPts: number } | null
  totalBirdies: number
  totalWipes: number
}

export function buildCourseReport(field: FieldRoundData, parByHole: Map<number, number>): CourseReport {
  const complete = field.players.filter(p => hasCompleteRound(p, field.totalHoles))
  const fieldAverage = complete.length > 0 ? complete.reduce((s, p) => s + sumPts(p.holes), 0) / complete.length : 0

  // Round winner — highest total Stableford points, same definition
  // findRoundPerformer already uses (not a second "who won" concept).
  let roundWinner: CourseReport['roundWinner'] = null
  for (const p of complete) {
    const total = sumPts(p.holes)
    if (!roundWinner || total > roundWinner.totalPts) roundWinner = { playerId: p.playerId, playerName: p.playerName, totalPts: total }
  }

  // Birdies/wipes — the exact same gross-one-under-par and zero-point
  // definitions findBirdieHunter/findWipeoutKing already use, summed
  // across the whole field rather than finding a single leader.
  const totalBirdies = complete.reduce((s, p) => s + birdieCount(p), 0)
  const totalWipes = complete.reduce((s, p) => s + wipeCount(p), 0)

  let easiest: { holeNumber: number; par: number; average: number } | null = null
  let hardest: { holeNumber: number; par: number; average: number } | null = null
  for (let holeNumber = 1; holeNumber <= field.totalHoles; holeNumber++) {
    const entries = complete.map(p => p.holes.find(h => h.holeNumber === holeNumber)).filter((h): h is PlayerHoleResult => h != null)
    if (entries.length < 2) continue
    const average = sumPts(entries) / entries.length
    const par = parByHole.get(holeNumber) ?? entries[0].par
    if (!easiest || average > easiest.average) easiest = { holeNumber, par, average }
    if (!hardest || average < hardest.average) hardest = { holeNumber, par, average }
  }
  return { fieldAverage, easiestHole: easiest, hardestHole: hardest, roundWinner, totalBirdies, totalWipes }
}

// ── Group Makers (new) ──────────────────────────────────────────────────

/** Sum of a member's gross birdies (one under par, gross-scoring term — matches findBirdieHunter's own definition, not repeated). */
export function birdieCount(m: PlayerRoundData): number {
  return m.holes.filter(h => h.grossScore === h.par - 1).length
}
export function wipeCount(m: PlayerRoundData): number {
  return m.holes.filter(h => h.stablefordPts === 0).length
}
/** Release 2, item 4 — pars (gross score equal to par), same convention as birdieCount/wipeCount, exported for the event-level engine to reuse rather than reimplement. */
export function parCount(m: PlayerRoundData): number {
  return m.holes.filter(h => h.grossScore === h.par).length
}
/** Release 2, item 4 — double-bogey-or-worse count (gross score >= par + 2), the standard golf definition, for the event-level "Most double bogeys or worse" breaker. */
export function doubleBogeyOrWorseCount(m: PlayerRoundData): number {
  return m.holes.filter(h => h.grossScore >= h.par + 2).length
}

export function findBackNineBandits(field: FieldRoundData): Highlight | null {
  // 18-hole only — same hard rule as the individual Back Nine King.
  if (field.totalHoles !== 18) return null
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => ({ group: g, avg: groupAverage(g.members, h => h.holeNumber >= 10) }))
  const best = scored.reduce((a, b) => (b.avg > a.avg ? b : a))
  // Same per-player threshold as Back Nine King (16) — this is a
  // per-player average, the same unit, so the same bar applies.
  if (best.avg < 16) return null
  return {
    category: 'back_nine_bandits', kind: 'maker', scope: 'group', icon: '👑', title: 'Back Nine Bandits',
    playerId: '', playerName: '', groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `${best.avg.toFixed(1)} pt player average coming home`,
    significance: best.avg,
  }
}

export function findTheClosers(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  // "Final 3 holes" respects played sequence (shotgun-correct), same
  // as the individual Fast Finish/Cold Start use getPlayedSequence
  // rather than raw hole numbers — a shotgun group's "final 3" isn't
  // necessarily holes 16-18.
  const scored = groups.map(g => {
    const perMember = g.members.map(m => sumPts(getPlayedSequence(m, field.totalHoles).slice(-3)))
    const avg = perMember.reduce((s, v) => s + v, 0) / perMember.length
    return { group: g, avg }
  })
  const best = scored.reduce((a, b) => (b.avg > a.avg ? b : a))
  if (best.avg < 6) return null // meaningful threshold — an ordinary finish shouldn't qualify
  return {
    category: 'the_closers', kind: 'maker', scope: 'group', icon: '🚀', title: 'The Closers',
    playerId: '', playerName: '', groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `${best.avg.toFixed(1)} pt player average over the closing 3`,
    significance: best.avg,
  }
}

export function findTheFortress(field: FieldRoundData): Highlight | null {
  // "Nobody blew up and everyone contributed" — strong group average,
  // low spread between members, few combined wipes. All three
  // conditions required, not any one alone (a strong average with one
  // disaster hidden in it isn't a Fortress).
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => {
    const totals = g.members.map(m => sumPts(m.holes))
    const avg = totals.reduce((s, t) => s + t, 0) / totals.length
    const spread = Math.max(...totals) - Math.min(...totals)
    const totalWipes = g.members.reduce((s, m) => s + wipeCount(m), 0)
    return { group: g, avg, spread, totalWipes }
  })
    .filter(c => c.avg >= 22 && c.totalWipes <= c.group.members.length && c.spread <= 8)
  if (scored.length === 0) return null
  const best = scored.reduce((a, b) => (b.avg > a.avg ? b : a))
  return {
    category: 'the_fortress', kind: 'maker', scope: 'group', icon: '🧱', title: 'The Fortress',
    playerId: '', playerName: '', groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `${best.avg.toFixed(1)} pt player average, only ${best.totalWipes} wipe${best.totalWipes === 1 ? '' : 's'} between them`,
    significance: best.avg - best.spread,
  }
}

export function findTheBirdcage(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => ({ group: g, birdies: g.members.reduce((s, m) => s + birdieCount(m), 0) }))
    .filter(c => c.birdies >= 3) // combined minimum — a single group birdie is not a story
  if (scored.length === 0) return null
  const best = scored.reduce((a, b) => (b.birdies > a.birdies ? b : a))
  return {
    category: 'the_birdcage', kind: 'maker', scope: 'group', icon: '🐦', title: 'The Birdcage',
    playerId: '', playerName: '', groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `${best.birdies} combined birdies`,
    significance: best.birdies,
  }
}

export function findDreamTeam(field: FieldRoundData): Highlight | null {
  // "Reward groups where everyone performed well, not one superstar
  // carrying three weak cards" — strong average AND low spread, same
  // two conditions as Fortress but without the wipe requirement
  // (Fortress is about resilience; Dream Team is about balance).
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => {
    const totals = g.members.map(m => sumPts(m.holes))
    const avg = totals.reduce((s, t) => s + t, 0) / totals.length
    const spread = Math.max(...totals) - Math.min(...totals)
    return { group: g, avg, spread }
  })
    .filter(c => c.avg >= 24 && c.spread <= 6)
  if (scored.length === 0) return null
  const best = scored.reduce((a, b) => (b.avg - b.spread > a.avg - a.spread ? b : a))
  return {
    category: 'dream_team', kind: 'maker', scope: 'group', icon: '🤝', title: 'The Dream Team',
    playerId: '', playerName: '', groupId: best.group.groupId, groupName: best.group.groupName,
    statLine: `Only ${best.spread} pts between highest and lowest player`,
    significance: best.avg - best.spread,
  }
}

// ── Group Breakers (new) ────────────────────────────────────────────────

export function findWheelsOff(field: FieldRoundData): Highlight | null {
  if (field.totalHoles !== 18) return null
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => {
    const front = groupAverage(g.members, h => h.holeNumber <= 9)
    const back = groupAverage(g.members, h => h.holeNumber >= 10)
    return { group: g, front, back, drop: front - back }
  })
    .filter(c => c.drop >= COLLAPSE_MIN_THRESHOLD) // same meaningful-drop bar as the individual Meltdown
  if (scored.length === 0) return null
  const worst = scored.reduce((a, b) => (b.drop > a.drop ? b : a))
  return {
    category: 'wheels_off', kind: 'breaker', scope: 'group', icon: '🛞', title: 'Wheels Off',
    playerId: '', playerName: '', groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `${worst.front.toFixed(1)} out, ${worst.back.toFixed(1)} home — per player`,
    significance: worst.drop,
  }
}

export function findDamageReport(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => ({
    group: g,
    totalWipes: g.members.reduce((s, m) => s + wipeCount(m), 0),
    perPlayer: g.members.reduce((s, m) => s + wipeCount(m), 0) / g.members.length,
  }))
    .filter(c => c.perPlayer >= 1.5) // normalised — a genuinely rough round for the whole group, not one bad player
  if (scored.length === 0) return null
  const worst = scored.reduce((a, b) => (b.totalWipes > a.totalWipes ? b : a))
  return {
    category: 'damage_report', kind: 'breaker', scope: 'group', icon: '🚑', title: 'The Damage Report',
    playerId: '', playerName: '', groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `${worst.totalWipes} wipes between them`,
    significance: worst.totalWipes,
  }
}

export function findDeepFreeze(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const windowSize = field.totalHoles === 18 ? 6 : 3
  const scored: { group: GroupBucket; avg: number }[] = []
  for (const g of groups) {
    // Per-member windowed sequences, averaged across the group at each
    // starting offset — same idea as the individual worst-consecutive-
    // stretch archetypes, just group-averaged per offset rather than
    // per player.
    let worstAvg: number | null = null
    for (let start = 0; start <= field.totalHoles - windowSize; start++) {
      const perMember = g.members.map(m => sumPts(getPlayedSequence(m, field.totalHoles).slice(start, start + windowSize)))
      const avg = perMember.reduce((s, v) => s + v, 0) / perMember.length
      if (worstAvg === null || avg < worstAvg) worstAvg = avg
    }
    if (worstAvg !== null) scored.push({ group: g, avg: worstAvg })
  }
  if (scored.length === 0) return null
  const worst = scored.reduce((a, b) => (b.avg < a.avg ? b : a))
  // Significant underperformance — windowSize holes at ~1pt/hole average or worse.
  if (worst.avg > windowSize * 1.2) return null
  return {
    category: 'deep_freeze', kind: 'breaker', scope: 'group', icon: '🥶', title: 'The Deep Freeze',
    playerId: '', playerName: '', groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `${worst.avg.toFixed(1)} pt player average over their worst ${windowSize} holes`,
    significance: windowSize * 4 - worst.avg,
  }
}

export function findStillInCarPark(field: FieldRoundData): Highlight | null {
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => {
    const perMember = g.members.map(m => sumPts(getPlayedSequence(m, field.totalHoles).slice(0, 3)))
    const avg = perMember.reduce((s, v) => s + v, 0) / perMember.length
    return { group: g, avg }
  })
    .filter(c => c.avg <= 4) // only qualifies if sufficiently bad, per the explicit instruction
  if (scored.length === 0) return null
  const worst = scored.reduce((a, b) => (b.avg < a.avg ? b : a))
  return {
    category: 'still_in_car_park', kind: 'breaker', scope: 'group', icon: '🚗', title: 'Still in the Car Park',
    playerId: '', playerName: '', groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `${worst.avg.toFixed(1)} pt player average over the opening 3`,
    significance: 10 - worst.avg,
  }
}

export function findBackNineBreakdown(field: FieldRoundData): Highlight | null {
  // 18-hole only. Deliberately the LOWEST absolute back-nine
  // performance, not the biggest drop (that's Wheels Off) — a group
  // that was mediocre all day and stayed mediocre on the back nine
  // qualifies here even with no meaningful "collapse."
  if (field.totalHoles !== 18) return null
  const groups = bucketByGroup(field)
  if (groups.length === 0) return null
  const scored = groups.map(g => ({ group: g, avg: groupAverage(g.members, h => h.holeNumber >= 10) }))
    .filter(c => c.avg <= 12) // per-player average over 9 holes — genuinely poor
  if (scored.length === 0) return null
  const worst = scored.reduce((a, b) => (b.avg < a.avg ? b : a))
  return {
    category: 'back_nine_breakdown', kind: 'breaker', scope: 'group', icon: '🏚️', title: 'Back Nine Breakdown',
    playerId: '', playerName: '', groupId: worst.group.groupId, groupName: worst.group.groupName,
    statLine: `${worst.avg.toFixed(1)} pt player average coming home`,
    significance: 20 - worst.avg,
  }
}

// ── Individual Breaker (new) ────────────────────────────────────────────

/**
 * Rollercoaster — "repeated alternation between good and poor
 * outcomes," explicitly distinguished from Maverick's "overall extreme
 * volatility with big highs and disasters" by counting genuine
 * direction reversals (a swing of 3+ Stableford points between
 * adjacent holes that also changes direction from the previous swing),
 * not just the raw count of highs/lows Maverick uses. A player who
 * goes low-low-low-high-high-high has big swings but no alternation;
 * a player who goes high-low-high-low-high-low has repeated
 * alternation even if no single swing is the biggest of the round.
 * This is a genuinely different, deterministic metric from Maverick's,
 * not the same count read differently.
 */
export function findRollercoaster(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => {
      const seq = getPlayedSequence(p, field.totalHoles)
      let reversals = 0
      let lastDirection: 'up' | 'down' | null = null
      for (let i = 1; i < seq.length; i++) {
        const diff = seq[i].stablefordPts - seq[i - 1].stablefordPts
        if (Math.abs(diff) < 3) continue // not a genuine swing
        const direction = diff > 0 ? 'up' : 'down'
        if (lastDirection && direction !== lastDirection) reversals++
        lastDirection = direction
      }
      return { player: p, reversals }
    })
    .filter(c => c.reversals >= 3) // repeated, not incidental
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.reversals > a.reversals ? b : a))
  return {
    category: 'rollercoaster', kind: 'breaker', scope: 'individual', icon: '🎢', title: 'The Rollercoaster',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.reversals} big swings, back and forth all day`,
    significance: best.reversals,
  }
}

/**
 * P0 field-test fix — archetype explanations. Per the explicit
 * requirement: "Archetype title → one short reusable definition
 * explaining the archetype" — the same one sentence every time
 * "Maverick" (or any other archetype) appears, completely independent
 * of who qualified or what their specific numbers were. statLine
 * remains exactly what it already was: the player/group-specific
 * evidence that qualified them (e.g. "2 big holes, 2 wipes") — this is
 * additive, a single new field, not a rewrite of the qualification
 * logic or the evidence text itself. Centralised here, at the one
 * place every archetype already converges (generateMakersAndBreakers
 * below), rather than duplicated across all 28 individual find*
 * functions — one authoritative definition per category, easy to
 * review as a complete set, and impossible for an individual archetype
 * to silently drift out of sync with this list.
 */
const ARCHETYPE_DEFINITIONS: Record<string, string> = {
  hot_start:            'Fast out of the gate — the front nine set the tone.',
  back_nine_king:        'Found another gear on the back nine, right when it mattered.',
  fast_finish:           'Finished stronger than they started — a big close.',
  birdie_hunter:         'Went hunting for birdies, and found them.',
  mr_consistent:         'Steady, unshakeable, the same score no matter the hole.',
  maverick:              'High risk. High reward. Anything could happen.',
  round_performer:       'Simply the best round on the course today.',
  mailman:               'Delivers. Every time, without fail.',
  wipeout_king:          'Big numbers, more than once — a rough day with the card.',
  cold_start:            'Never got going — the front nine never arrived.',
  the_collapse:          'Had it, then lost it — a real mid-round unravelling.',
  rough_finish:          'Faded hard down the stretch, right at the death.',
  hole_from_hell:        'One hole, one disaster — everyone else loved it.',
  one_that_got_away:     'So close to something special — and then it slipped.',
  goose:                 'Had the double points on offer, and let it go.',
  hot_group:             'The group to beat — scoring hot as a team.',
  black_hole_group:      'A group that couldn\u2019t buy a point between them.',
  back_nine_bandits:     'Snuck up on the back nine as a group, together.',
  the_closers:           'Finished the round strongest as a unit.',
  the_fortress:          'Nothing got through — relentlessly solid as a group.',
  the_birdcage:          'A group full of birdies, feeding off each other.',
  dream_team:            'Every player pulling their weight — the complete group.',
  wheels_off:            'It all came apart for this group, and fast.',
  damage_report:         'A group with more big numbers than good ones.',
  deep_freeze:           'Cold as a group, right when it counted.',
  still_in_car_park:     'This group never really teed off at all.',
  back_nine_breakdown:   'Held it together on the front, then it all fell apart.',
  rollercoaster:         'Up, down, up, down — no telling what\u2019s coming next.',
}

export function generateMakersAndBreakers(field: FieldRoundData): { makers: Highlight[]; breakers: Highlight[] } {
  const withDefinition = (h: Highlight | null): Highlight | null =>
    h ? { ...h, definition: ARCHETYPE_DEFINITIONS[h.category] ?? '' } : null

  const makers = [
    findMailman(field), findHotStart(field), findBackNineKing(field), findFastFinish(field),
    findBirdieHunter(field), findMrConsistent(field),
    findHotGroup(field), findBackNineBandits(field), findTheClosers(field), findTheFortress(field), findTheBirdcage(field), findDreamTeam(field),
  ].map(withDefinition).filter((h): h is Highlight => h !== null)
    .sort((a, b) => b.significance - a.significance) // strongest candidates first, per the explicit ranking requirement

  const breakers = [
    findWipeoutKing(field), findColdStart(field), findTheCollapse(field),
    findRoughFinish(field), findHoleFromHell(field), findOneThatGotAway(field),
    findGoose(field), findBlackHoleGroup(field), findMaverick(field), findRollercoaster(field),
    findWheelsOff(field), findDamageReport(field), findDeepFreeze(field), findStillInCarPark(field), findBackNineBreakdown(field),
  ].map(withDefinition).filter((h): h is Highlight => h !== null)
    .sort((a, b) => b.significance - a.significance)

  return { makers, breakers }
}
