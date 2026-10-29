// M0 (Package 4) -- format registry INTERFACE. Design only: nothing imports this yet, so behaviour is unchanged.
//
// Scope is deliberately small: only the formats on the roadmap (individual Stableford, Ambrose 2/4, match play).
// Unknown or legacy `rounds.scoring_format` values resolve to "not playable" -- they never silently become Stableford
// for a NEW round, but every EXISTING round keeps running through the untouched Stableford code (see resolveFormatForExistingRound).

export type ScoringFormatId = 'stableford' | 'ambrose_2' | 'ambrose_4' | 'singles_match_play' | 'four_ball_match_play'

/** What the official score for a round is recorded against. */
export type ScorecardKind = 'individual' | 'team' | 'match'

export type PlayableStatus = 'playable' | 'planned'

export interface FormatDefinition {
  id: ScoringFormatId
  label: string
  status: PlayableStatus
  scorecard: ScorecardKind
  /** Who the results are about. */
  participants: 'players' | 'competition_teams' | 'match_sides'
  /** The stored value in rounds.scoring_format (the CHECK constraint allows a fixed set; see migration 004). */
  storedValue: string
  /** How a score may be written (references the capture model; team formats will add their own rule in M1). */
  authority: 'self_and_marker' | 'nominated_team_scorer' | 'per_player_with_match_state'
  /** Handicap treatment, resolved from saved snapshots, never recomputed from a changed profile. */
  handicap: 'individual_playing_handicap' | 'team_method_snapshot' | 'match_allowance_snapshot'
  /** Side Games that may be enabled alongside the primary format. Individually attributed games are compatible with every format. */
  sideGames: { individualAttributed: boolean; skins: 'individual_gross_scores' | 'not_supported' }
  /** Whether Makers & Breakers (individual achievement rules) applies. */
  makersAndBreakers: boolean
}

export const FORMATS: Record<ScoringFormatId, FormatDefinition> = {
  stableford: {
    id: 'stableford', label: 'Individual Stableford', status: 'playable', scorecard: 'individual', participants: 'players', storedValue: 'stableford',
    authority: 'self_and_marker', handicap: 'individual_playing_handicap',
    sideGames: { individualAttributed: true, skins: 'individual_gross_scores' }, makersAndBreakers: true,
  },
  ambrose_2: {
    id: 'ambrose_2', label: 'Two-Person Ambrose', status: 'planned', scorecard: 'team', participants: 'competition_teams', storedValue: 'ambrose',
    authority: 'nominated_team_scorer', handicap: 'team_method_snapshot',
    sideGames: { individualAttributed: true, skins: 'not_supported' }, makersAndBreakers: false,
  },
  ambrose_4: {
    id: 'ambrose_4', label: 'Four-Person Ambrose', status: 'planned', scorecard: 'team', participants: 'competition_teams', storedValue: 'ambrose',
    authority: 'nominated_team_scorer', handicap: 'team_method_snapshot',
    sideGames: { individualAttributed: true, skins: 'not_supported' }, makersAndBreakers: false,
  },
  singles_match_play: {
    id: 'singles_match_play', label: 'Singles Match Play', status: 'planned', scorecard: 'match', participants: 'match_sides', storedValue: 'match_play',
    authority: 'per_player_with_match_state', handicap: 'match_allowance_snapshot',
    sideGames: { individualAttributed: true, skins: 'not_supported' }, makersAndBreakers: false,
  },
  four_ball_match_play: {
    id: 'four_ball_match_play', label: 'Four-ball Better-ball', status: 'planned', scorecard: 'match', participants: 'match_sides', storedValue: 'four_ball_better_ball',
    authority: 'per_player_with_match_state', handicap: 'match_allowance_snapshot',
    sideGames: { individualAttributed: true, skins: 'not_supported' }, makersAndBreakers: false,
  },
}

/** Formats an organiser may choose for a NEW round today: playable ones only. Nothing "planned" can be enabled silently. */
export function selectableFormats(): FormatDefinition[] {
  return Object.values(FORMATS).filter(f => f.status === 'playable')
}

/**
 * Backward compatibility rule: every round that exists today (stored value 'stableford', and any legacy/unknown value --
 * the column default was always 'stableford') is played, scored and presented by the existing Stableford code, exactly as
 * in V7. Only a round explicitly created with a planned format, once that format ships, uses another path.
 */
export function resolveFormatForExistingRound(storedValue: string | null | undefined): FormatDefinition {
  const playable = Object.values(FORMATS).find(f => f.status === 'playable' && f.storedValue === storedValue)
  return playable ?? FORMATS.stableford
}

/** Skins is a Side Game (My HQ -> Side Games), never a primary format. Compatible only where the format exposes individual gross scores. */
export function skinsCompatible(format: FormatDefinition): boolean {
  return format.sideGames.skins !== 'not_supported'
}

/** Guards against enabling an invalid combination silently. */
export function validateSideGameCombination(format: FormatDefinition, sideGame: 'nearest_pin' | 'longest_drive' | 'pros_approach' | 'skins'): { ok: true } | { ok: false; reason: string } {
  if (sideGame === 'skins') return skinsCompatible(format) ? { ok: true } : { ok: false, reason: `Skins is not available with ${format.label} yet.` }
  return format.sideGames.individualAttributed ? { ok: true } : { ok: false, reason: `${sideGame} is not available with ${format.label}.` }
}
