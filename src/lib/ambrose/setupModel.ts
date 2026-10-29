// Package 4 / M2 -- organiser setup checklist. PURE. Decides which setup steps are done and whether the organiser may start scoring.
// Net results stay switched off until the handicap rules are verified (see handicapApproved): gross scoring does not need them.

export interface SetupEntryState {
  entryId: string; teamName: string; memberCount: number; expectedSize: 2 | 4
  scorerConfirmed: boolean; handicapLocked: boolean; withdrawn?: boolean
}
export interface SetupInput {
  formatConfigured: boolean
  expectedSize: 2 | 4
  /** Players the organiser has put in groups but not on any saved team. */
  unassignedPlayerCount: number
  /** Suggestions the organiser has not saved yet. */
  unsavedSuggestionCount: number
  entries: SetupEntryState[]
  /** FALSE in production until the Daily Handicap and Ambrose allowance rules are verified and approved. */
  handicapApproved: boolean
  roundReleased: boolean
  acceptedScoresExist: boolean
  /** The organiser has reopened a released round's set-up (audited) and has not re-locked it. */
  setupReopened?: boolean
}
export type StepStatus = 'done' | 'todo' | 'blocked'
export interface SetupStep { key: 'format' | 'teams' | 'scorers' | 'handicaps' | 'release'; title: string; status: StepStatus; detail: string }
export interface SetupModel { steps: SetupStep[]; canStartScoring: boolean; blockers: string[]; teamsEditable: boolean; teamsLockReason: string | null
  /** Set-up is frozen because the round is released, but may be reopened (with a reason) until the first score. */
  canReopen: boolean; canRelock: boolean
  /** Ambrose scoring is started through the existing My HQ Begin Round flow only; this tells the organiser where they are. */
  startHandOff: string }

export function buildSetupModel(i: SetupInput): SetupModel {
  const live = i.entries.filter(e => !e.withdrawn)
  const badSize = live.filter(e => e.memberCount !== i.expectedSize)
  const teamsOk = i.formatConfigured && live.length > 0 && i.unassignedPlayerCount === 0 && i.unsavedSuggestionCount === 0 && badSize.length === 0
  const noScorer = live.filter(e => !e.scorerConfirmed)
  const scorersOk = live.length > 0 && noScorer.length === 0
  const teamsDetail = !i.formatConfigured ? 'Choose the format first.'
    : live.length === 0 ? 'No teams saved yet.'
    : i.unassignedPlayerCount > 0 ? `${i.unassignedPlayerCount} player${i.unassignedPlayerCount === 1 ? ' is' : 's are'} not on a team.`
    : i.unsavedSuggestionCount > 0 ? `${i.unsavedSuggestionCount} suggested team${i.unsavedSuggestionCount === 1 ? '' : 's'} not saved yet.`
    : badSize.length > 0 ? `${badSize.length} team${badSize.length === 1 ? ' does' : 's do'} not have exactly ${i.expectedSize} players.`
    : `${live.length} team${live.length === 1 ? '' : 's'} saved.`
  const steps: SetupStep[] = [
    { key: 'format', title: 'Format', status: i.formatConfigured ? 'done' : 'todo', detail: i.formatConfigured ? `${i.expectedSize}-person Ambrose, gross scoring (no handicap).` : 'Not chosen yet.' },
    { key: 'teams', title: 'Teams', status: teamsOk ? 'done' : 'todo', detail: teamsDetail },
    { key: 'scorers', title: 'Scorers', status: scorersOk ? 'done' : 'todo', detail: !live.length ? 'Save teams first.' : noScorer.length ? `${noScorer.length} team${noScorer.length === 1 ? ' has' : 's have'} no confirmed scorer.` : 'Every team has a confirmed scorer.' },
    { key: 'handicaps', title: 'Handicaps', status: i.handicapApproved ? (live.length && live.every(e => e.handicapLocked) ? 'done' : 'todo') : 'blocked',
      detail: i.handicapApproved ? 'Lock each team handicap before net results are shown.' : 'Net results are switched off until the handicap rules are verified. Gross scoring is available.' },
    { key: 'release', title: 'Release & start (My HQ)', status: i.roundReleased ? 'done' : 'todo', detail: i.roundReleased ? 'The round has been released from My HQ.' : 'Teams lock when the round is released from My HQ.' },
  ]
  const blockers: string[] = []
  if (!i.formatConfigured) blockers.push('Choose the Ambrose format.')
  if (!teamsOk && i.formatConfigured) blockers.push(teamsDetail)
  if (live.length > 0 && !scorersOk) blockers.push(steps[2].detail)
  const canStartScoring = blockers.length === 0 && !i.roundReleased
  const frozenByRelease = i.roundReleased && !i.setupReopened
  const teamsEditable = !i.acceptedScoresExist && !frozenByRelease
  const teamsLockReason = i.acceptedScoresExist ? 'Scores have been recorded. Team members can no longer be changed here; ask for an audited correction.'
    : frozenByRelease ? 'The round has been released, so team set-up is locked. Reopen it (with a reason) to correct a team before scoring starts.' : null
  return { steps, canStartScoring, blockers, teamsEditable, teamsLockReason,
    canReopen: i.roundReleased && !i.setupReopened && !i.acceptedScoresExist,
    canRelock: i.roundReleased && !!i.setupReopened,
    startHandOff: i.roundReleased ? 'Scoring is started from My HQ.' : canStartScoring ? 'Ready. Release and start the round from My HQ (Begin Round).' : 'Finish the steps above, then release and start the round from My HQ.' }
}
