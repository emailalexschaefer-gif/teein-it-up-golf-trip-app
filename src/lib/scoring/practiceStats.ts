export interface PracticeHoleInput {
  holeNumber: number
  par: number
  grossScore: number | null
  pickedUp: boolean
  stablefordPts: number | null
  fairwayHit: boolean | null // null = not answered, distinct from false
  gir: boolean | null        // same
  putts: number | null       // same
}

export interface PracticeStatsResult {
  holesCompleted: number
  grossTotal: number
  stablefordTotal: number
  // Fairways — Par 4/5 only ("eligible"); "answered" is the subset of
  // eligible holes where the golfer actually entered Yes/No.
  fairwaysEligible: number
  fairwaysAnswered: number
  fairwaysHit: number
  fairwayPct: number | null // null when fairwaysAnswered === 0 — never 0%
  // GIR — every hole is eligible; "answered" only counts real entries.
  girEligible: number
  girAnswered: number
  girHit: number
  girPct: number | null
  // Putts — only holes where a putt count was actually entered.
  puttsAnswered: number
  totalPutts: number
  puttsPerHole: number | null // null when puttsAnswered === 0
}

/**
 * Practice V2 (8 Sep), item 4 — the single source of truth for every
 * "how am I going" percentage shown anywhere (live My Stats, Practice
 * Summary, My Golf Practice History/Progress all call this same
 * function, never recompute independently).
 *
 * DENOMINATOR RULES, explicit per the brief's own explicit warning:
 * - Fairways: eligible = Par 4/5 holes only (Par 3 never counts as an
 *   opportunity at all, not even as "unanswered"). Of those eligible
 *   holes, "answered" is the subset with fairwayHit !== null.
 *   fairwayPct = fairwaysHit / fairwaysAnswered, NEVER / fairwaysEligible
 *   — an unanswered fairway question is not a miss, and including it
 *   in the denominator would silently and incorrectly lower the
 *   percentage.
 * - GIR: every hole is eligible; same answered/hit-only-of-answered
 *   rule.
 * - Putts: totalPutts/puttsPerHole are computed only from holes where
 *   a putt count was actually entered — a missing putt entry is never
 *   treated as 0.
 *
 * A hole with no gross score at all (not yet played) does not count
 * toward holesCompleted, and its stats (if any were somehow entered
 * ahead of the score) still count toward the fairway/GIR/putts
 * denominators independently — completion and stat-answering are two
 * separate, independent facts, matching the brief's own
 * "optional, never blocks Next Hole" framing.
 */
export function calculatePracticeStats(holes: PracticeHoleInput[]): PracticeStatsResult {
  let holesCompleted = 0
  let grossTotal = 0
  let stablefordTotal = 0
  let fairwaysEligible = 0
  let fairwaysAnswered = 0
  let fairwaysHit = 0
  let girAnswered = 0
  let girHit = 0
  let puttsAnswered = 0
  let totalPutts = 0

  for (const h of holes) {
    const hasScore = h.pickedUp || h.grossScore !== null
    if (hasScore) {
      holesCompleted += 1
      if (!h.pickedUp && h.grossScore !== null) grossTotal += h.grossScore
      if (h.stablefordPts !== null) stablefordTotal += h.stablefordPts
    }

    const isFairwayEligible = h.par === 4 || h.par === 5
    if (isFairwayEligible) {
      fairwaysEligible += 1
      if (h.fairwayHit !== null) {
        fairwaysAnswered += 1
        if (h.fairwayHit) fairwaysHit += 1
      }
    }

    if (h.gir !== null) {
      girAnswered += 1
      if (h.gir) girHit += 1
    }

    if (h.putts !== null) {
      puttsAnswered += 1
      totalPutts += h.putts
    }
  }

  return {
    holesCompleted, grossTotal, stablefordTotal,
    fairwaysEligible, fairwaysAnswered, fairwaysHit,
    fairwayPct: fairwaysAnswered > 0 ? Math.round((fairwaysHit / fairwaysAnswered) * 100) : null,
    girEligible: holes.length, girAnswered, girHit,
    girPct: girAnswered > 0 ? Math.round((girHit / girAnswered) * 100) : null,
    puttsAnswered, totalPutts,
    puttsPerHole: puttsAnswered > 0 ? Math.round((totalPutts / puttsAnswered) * 100) / 100 : null,
  }
}
