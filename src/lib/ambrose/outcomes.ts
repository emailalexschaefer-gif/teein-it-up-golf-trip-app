// Package 4 / M2 -- the single mapping from a database outcome (submit_team_score & friends) to an HTTP status, a queue disposition
// and a message a person can act on. Used by BOTH the API handler and the offline queue runner so they cannot disagree.

export type Disposition = 'synced' | 'conflict' | 'locked' | 'rejected' | 'auth'

export interface OutcomeInfo { disposition: Disposition; http: number; message: string }

const OK = ['inserted', 'updated', 'duplicate', 'flagged', 'assigned', 'released', 'resolved', 'closed', 'waived', 'created', 'saved', 'configured', 'handicap_locked', 'reopened', 'relocked']

const TABLE: Record<string, { d: Disposition; http: number; msg: string }> = {
  conflict:             { d: 'conflict', http: 409, msg: 'The team score was changed since you last saw it.' },
  locked:               { d: 'locked',   http: 409, msg: 'The organiser has set this hole. Ask the organiser if it needs to change.' },
  not_authenticated:    { d: 'auth',     http: 401, msg: 'Signed out of Teein’ It Up — sign in again.' },
  not_authorised:       { d: 'rejected', http: 403, msg: 'You are not the scorer for this team.' },
  scorer_not_confirmed: { d: 'rejected', http: 422, msg: 'The organiser has not confirmed a scorer for this team yet.' },
  round_closed:         { d: 'rejected', http: 422, msg: 'This round is closed. Ask the organiser to make a correction.' },
  entry_withdrawn:      { d: 'rejected', http: 422, msg: 'This team has withdrawn from the round.' },
  reason_required:      { d: 'rejected', http: 422, msg: 'A reason is required for an organiser change.' },
  invalid_base:         { d: 'rejected', http: 422, msg: 'The score request was out of step with the server. Reload the scorecard.' },
  invalid_value:        { d: 'rejected', http: 422, msg: 'That score is not valid.' },
  invalid_hole:         { d: 'rejected', http: 422, msg: 'That hole does not belong to this round.' },
  invalid_drive_player: { d: 'rejected', http: 422, msg: 'The selected drive is not from a player on this team.' },
  invalid_scorer:       { d: 'rejected', http: 422, msg: 'The scorer must be on the team roster.' },
  not_found:            { d: 'rejected', http: 404, msg: 'Team entry not found.' },
  not_locked:           { d: 'rejected', http: 422, msg: 'That hole is not locked.' },
  not_no_return:        { d: 'rejected', http: 422, msg: 'That hole is not a No Return.' },
  already_closed:       { d: 'rejected', http: 422, msg: 'That query is already closed.' },
  // Organiser set-up refusals (create team / configure round / save roster / lock handicap).
  scoring_started:      { d: 'rejected', http: 409, msg: 'Scoring has started for this team. Team set-up can no longer be changed here; ask for an audited correction.' },
  setup_locked:         { d: 'rejected', http: 409, msg: 'Team set-up is locked because the round has been released. The organiser can reopen it with a reason before scoring starts.' },
  setup_not_locked:     { d: 'rejected', http: 422, msg: 'Team set-up is not locked, so there is nothing to reopen.' },
  setup_not_reopened:   { d: 'rejected', http: 422, msg: 'Team set-up has not been reopened.' },
  duplicate_name:       { d: 'rejected', http: 409, msg: 'A team with that name already exists in this event.' },
  player_in_other_team: { d: 'rejected', http: 409, msg: 'A player is already on another team in this round.' },
  not_configured:       { d: 'rejected', http: 422, msg: 'Choose the Ambrose format for this round first.' },
  team_not_in_event:    { d: 'rejected', http: 422, msg: 'That team does not belong to this event.' },
  wrong_team_size:      { d: 'rejected', http: 422, msg: 'The team does not have the number of players this format needs.' },
  not_trip_member:      { d: 'rejected', http: 422, msg: 'A selected player is not a member of this event.' },
  group_not_in_event:   { d: 'rejected', http: 422, msg: 'That playing group does not belong to this event.' },
  method_mismatch:      { d: 'rejected', http: 422, msg: 'The handicap method does not match the round’s configured method.' },
  roster_mismatch:      { d: 'rejected', http: 422, msg: 'The handicap record does not match the team’s players.' },
}

/** Unknown outcomes are NOT treated as success: they are rejected visibly (and kept on the device). */
export function classifyOutcome(outcome: unknown): OutcomeInfo {
  if (typeof outcome === 'string' && OK.includes(outcome)) return { disposition: 'synced', http: 200, message: '' }
  if (typeof outcome === 'string' && TABLE[outcome]) { const t = TABLE[outcome]; return { disposition: t.d, http: t.http, message: t.msg } }
  return { disposition: 'rejected', http: 502, message: 'The server gave an unexpected answer. The score is kept on this device.' }
}

export const isOkOutcome = (o: unknown) => typeof o === 'string' && OK.includes(o)
