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
}

export interface FieldRoundData {
  players: PlayerRoundData[]
  totalHoles: number // 9 or 18
}

export interface Highlight {
  category: string
  kind: 'maker' | 'breaker'
  icon: string
  title: string
  playerId: string
  playerName: string
  statLine: string
  caption?: string
}

/**
 * Reorders a player's holes (given in hole-number order) into the order
 * they actually played them — starting at startingHole and wrapping
 * around. For a standard round (startingHole = 1) this is a no-op; the
 * reorder only does real work for shotgun starts. This is the single
 * place "played sequence" is computed — every category below that
 * needs opening/closing holes goes through this function rather than
 * reimplementing the wraparound logic.
 */
export function getPlayedSequence(player: PlayerRoundData, totalHoles: number): PlayerHoleResult[] {
  const byHoleNumber = new Map(player.holes.map(h => [h.holeNumber, h]))
  const sequence: PlayerHoleResult[] = []
  for (let i = 0; i < totalHoles; i++) {
    const holeNumber = ((player.startingHole - 1 + i) % totalHoles) + 1
    const hole = byHoleNumber.get(holeNumber)
    if (hole) sequence.push(hole)
  }
  return sequence
}

function sumPts(holes: PlayerHoleResult[]): number {
  return holes.reduce((sum, h) => sum + h.stablefordPts, 0)
}

function hasCompleteRound(player: PlayerRoundData, totalHoles: number): boolean {
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
  return {
    category: 'hot_start', kind: 'maker', icon: '🔥', title: 'Hot Start',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points from the opening 3 holes`,
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
  return {
    category: 'back_nine_king', kind: 'maker', icon: '👑', title: 'Back Nine King',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points coming home`,
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
  return {
    category: 'fast_finish', kind: 'maker', icon: '🚀', title: 'Fast Finish',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} points over the final 3`,
  }
}

export function findBirdieHunter(field: FieldRoundData): Highlight | null {
  // Birdie is a gross-scoring term (one under par on the hole), not a
  // handicap-adjusted one — matches the standard golf definition, not
  // the nett-based Stableford calculation used elsewhere.
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, birdies: p.holes.filter(h => h.grossScore === h.par - 1).length }))
    .filter(c => c.birdies > 0)
  if (candidates.length === 0) return null
  const maxBirdies = Math.max(...candidates.map(c => c.birdies))
  const best = candidates.find(c => c.birdies === maxBirdies)!
  return {
    category: 'birdie_hunter', kind: 'maker', icon: '🐦', title: 'Birdie Hunter',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.birdies} birdie${best.birdies === 1 ? '' : 's'}`,
  }
}

export function findMrConsistent(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, count: p.holes.filter(h => h.stablefordPts >= 2).length }))
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.count > a.count ? b : a))
  return {
    category: 'mr_consistent', kind: 'maker', icon: '💪', title: 'Mr Consistent',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.count} holes of 2 points or better`,
  }
}

export function findRoundPerformer(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, pts: sumPts(p.holes) }))
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.pts > a.pts ? b : a))
  return {
    category: 'round_performer', kind: 'maker', icon: '⭐', title: 'Round Performer',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.pts} Stableford points`,
  }
}

// ── BREAKERS ────────────────────────────────────────────────────────────

export function findWipeoutKing(field: FieldRoundData): Highlight | null {
  const candidates = field.players
    .filter(p => hasCompleteRound(p, field.totalHoles))
    .map(p => ({ player: p, wipes: p.holes.filter(h => h.stablefordPts === 0).length }))
    .filter(c => c.wipes > 0)
  if (candidates.length === 0) return null
  const maxWipes = Math.max(...candidates.map(c => c.wipes))
  const best = candidates.find(c => c.wipes === maxWipes)!
  return {
    category: 'wipeout_king', kind: 'breaker', icon: '💥', title: 'Wipeout King',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `${best.wipes} wipe${best.wipes === 1 ? '' : 's'} today`,
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
  return {
    category: 'cold_start', kind: 'breaker', icon: '🧊', title: 'Cold Start',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.pts} points from the opening 3`,
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
    category: 'the_collapse', kind: 'breaker', icon: '📉', title: 'The Collapse',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.front} out. ${worst.back} home.`,
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
  return {
    category: 'rough_finish', kind: 'breaker', icon: '😬', title: 'Rough Finish',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${worst.pts} points over the final 3`,
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
    category: 'hole_from_hell', kind: 'breaker', icon: '🕳️', title: 'Hole from Hell',
    playerId: best.player.playerId, playerName: best.player.playerName,
    statLine: `Field average: ${best.fieldAvg.toFixed(1)} pts \u00b7 ${best.player.playerName.split(' ')[0]}: 0`,
    caption: `Everyone liked hole ${best.holeNumber}. ${best.player.playerName.split(' ')[0]} apparently didn't.`,
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
    category: 'one_that_got_away', kind: 'breaker', icon: '💔', title: 'One That Got Away',
    playerId: worst.player.playerId, playerName: worst.player.playerName,
    statLine: `${positionLabel(worst.earlyPos)} after ${snapshotHoles}. Finished ${worst.finalPos === 1 ? '1st' : `${worst.finalPos}${ordinalSuffix(worst.finalPos)}`}.`,
  }
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'st'
  if (n % 10 === 2 && n % 100 !== 12) return 'nd'
  if (n % 10 === 3 && n % 100 !== 13) return 'rd'
  return 'th'
}

export function generateMakersAndBreakers(field: FieldRoundData): { makers: Highlight[]; breakers: Highlight[] } {
  const makers = [
    findHotStart(field), findBackNineKing(field), findFastFinish(field),
    findBirdieHunter(field), findMrConsistent(field), findRoundPerformer(field),
  ].filter((h): h is Highlight => h !== null)

  const breakers = [
    findWipeoutKing(field), findColdStart(field), findTheCollapse(field),
    findRoughFinish(field), findHoleFromHell(field), findOneThatGotAway(field),
  ].filter((h): h is Highlight => h !== null)

  return { makers, breakers }
}
