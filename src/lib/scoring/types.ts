/**
 * Explicit handicap type aliases, so a bare `number` never has to stand in
 * for "which handicap is this, exactly?" GA handicap, daily handicap,
 * playing handicap, and team handicap are different numbers with
 * different meanings and different sources — silently mixing them up is a
 * real bug class in golf scoring software (point 9 of the format update).
 *
 * These are plain aliases, not branded/nominal types — deliberately, so
 * they compose cleanly with the existing `scorecards.playing_handicap:
 * number` field and every current call site without a breaking refactor.
 * Their job is documentation and consistent naming at every function
 * boundary in this module, not compiler-enforced non-interchangeability.
 */

/** The player's official Golf Australia / national handicap index. */
export type GaHandicap = number

/** GA handicap adjusted for a specific course's slope rating (point 4). */
export type DailyHandicap = number

/** The handicap actually locked into a scorecard for a round (Sprint 5A). */
export type PlayingHandicap = number

/** A combined handicap for a team format (Ambrose, alternate shot). */
export type TeamPlayingHandicap = number

export type RoundingMode = 'nearest'

export type TeamFormat = 'two_player_ambrose' | 'four_player_ambrose' | 'alternate_shot'

/**
 * More than a bare number — enough to audit, explain, and troubleshoot a
 * team handicap calculation after the fact (point 10).
 */
export interface TeamHandicapResult {
  format: TeamFormat
  playerHandicaps: number[]
  combinedHandicap: number
  allowance: number
  unroundedHandicap: number
  finalHandicap: TeamPlayingHandicap
  roundingMode: RoundingMode
}
