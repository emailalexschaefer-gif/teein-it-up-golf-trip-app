// ─────────────────────────────────────────────────────────────────────────────
// STABLEFORD SCORING ENGINE
// Client-side calculation that mirrors the PostgreSQL DB function.
// Used for optimistic UI updates before server confirmation.
// The DB function is the source of truth — this must match it exactly.
// ─────────────────────────────────────────────────────────────────────────────

export interface StablefordInput {
  grossScore: number
  par: number
  strokeIndex: number       // Hole's stroke index (1 = hardest, 18 = easiest)
  playingHandicap: number   // Player's handicap for this round
}

export interface StablefordResult {
  grossScore: number
  handicapStrokes: number   // Strokes received on this hole
  netScore: number          // gross - handicapStrokes
  scoreVsPar: number        // netScore - par
  stablefordPts: number     // Points awarded
  label: string             // "Eagle", "Birdie", "Par", etc.
}

/**
 * Calculate Stableford points for a single hole.
 *
 * Handicap strokes per hole:
 * - A player with handicap 18 gets 1 stroke on every hole (SI 1-18)
 * - A player with handicap 36 gets 2 strokes on every hole
 * - A player with handicap 9 gets 1 stroke on holes with SI 1-9
 *
 * Points:
 *   net score vs par | points
 *   -3 or better     |  5  (Albatross+)
 *   -2               |  4  (Eagle)
 *   -1               |  3  (Birdie)
 *    0               |  2  (Par)
 *   +1               |  1  (Bogey)
 *   +2 or worse      |  0  (No score)
 */
export function calculateStableford(input: StablefordInput): StablefordResult {
  const { grossScore, par, strokeIndex, playingHandicap } = input

  // How many strokes does this player receive on this hole?
  // Full strokes: floor(handicap / 18)
  // Extra stroke: if strokeIndex <= (handicap % 18)
  const fullStrokes = Math.floor(playingHandicap / 18)
  const extraStroke = strokeIndex <= (playingHandicap % 18) ? 1 : 0
  const handicapStrokes = fullStrokes + extraStroke

  const netScore = grossScore - handicapStrokes
  const scoreVsPar = netScore - par

  // Points: max(0, 2 - scoreVsPar)
  // Cap at 5 points (albatross or better on a par 5 with strokes)
  const stablefordPts = Math.min(5, Math.max(0, 2 - scoreVsPar))

  return {
    grossScore,
    handicapStrokes,
    netScore,
    scoreVsPar,
    stablefordPts,
    label: getScoreLabel(scoreVsPar),
  }
}

function getScoreLabel(scoreVsPar: number): string {
  if (scoreVsPar <= -3) return 'Albatross'
  if (scoreVsPar === -2) return 'Eagle'
  if (scoreVsPar === -1) return 'Birdie'
  if (scoreVsPar === 0)  return 'Par'
  if (scoreVsPar === 1)  return 'Bogey'
  if (scoreVsPar === 2)  return 'Double Bogey'
  if (scoreVsPar === 3)  return 'Triple Bogey'
  return `+${scoreVsPar}`
}

/**
 * Calculate total Stableford points for a complete round.
 */
export function calculateRoundTotal(
  holeResults: StablefordResult[]
): number {
  return holeResults.reduce((sum, h) => sum + h.stablefordPts, 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT ROUTER
// All scoring logic is dispatched through here.
// Adding a new format = add a new case. No changes to callers needed.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScoringFormat } from '@/types/database'

export function getScoringFormatLabel(format: ScoringFormat): string {
  const labels: Record<ScoringFormat, string> = {
    stableford:            'Stableford',
    stroke:                'Stroke Play',
    match_play:            'Match Play',
    ambrose:               'Ambrose',
    four_ball_better_ball: 'Four Ball Better Ball',
  }
  return labels[format]
}

/**
 * Returns true if a scoring format is available to use in V1.
 * Others are roadmap items — surface as "coming soon" in UI.
 */
export function isFormatAvailable(format: ScoringFormat): boolean {
  const available: ScoringFormat[] = ['stableford']
  return available.includes(format)
}
