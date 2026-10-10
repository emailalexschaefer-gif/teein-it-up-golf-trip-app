/**
 * My HQ V2 (10 Oct) -- the five-stage guided organiser workflow.
 *
 * Phase B (approved) -> Phase C. This is deliberately a pure function:
 * every input is a plain value already produced by existing,
 * authoritative sources (round.status from the rounds table; the
 * Close Round readiness pair -- completionPct/awaitingReconciliation
 * -- straight from the existing `/tournament` route's own summary,
 * unchanged; publishedHighlights straight from the existing
 * `published_round_highlights` row). No stage's status is ever set by
 * which buttons the organiser has clicked, and no new persisted state
 * is introduced here at all -- this file only READS.
 *
 * Status model per stage:
 *   - complete:   the stage's own authoritative condition is met.
 *   - reached:    the round's progress has genuinely gotten this far
 *                 (distinct from "actionable" -- Stage 3 is "reached"
 *                 the moment a round goes active, long before it's
 *                 actually ready to close; the approved refinement
 *                 requires Stage 3 to stay visible with a "waiting"
 *                 explanation throughout live play, never disappear
 *                 or look skipped).
 *   - actionable: the organiser can genuinely perform this stage's
 *                 primary action right now (Stage 3 becomes
 *                 actionable only once the EXISTING Close Round
 *                 button's own condition is met -- reused verbatim,
 *                 not recalculated).
 *
 * Primary-action priority (approved refinement 5): exactly one stage
 * (or none) is ever flagged as THE primary recommended action, chosen
 * by walking the stages in their fixed order and taking the first one
 * that is both genuinely actionable and not yet complete. Stage 2
 * ("Manage Round") has no button of its own -- it's what the
 * organiser is already doing throughout live play, communicated via
 * its own live-progress text, not a CTA -- so it's excluded from the
 * primary-action search entirely, matching the brief's own worked
 * example (no action button shown for Manage Round while scoring is
 * under way). Stage 5 can be independently "actionable" (a
 * presentation is optional and never gated on anything), but Stage 4
 * is checked first in the fixed order, so Stage 5 only becomes the
 * primary action once Stage 4 is complete -- it never competes as a
 * second primary action while Stage 4 is outstanding, exactly as
 * approved.
 */

export type WorkflowStageId = 'start' | 'manage' | 'close' | 'makersBreakers' | 'reviewPresent'

export interface WorkflowStage {
  id: WorkflowStageId
  label: string
  /** The stage's own authoritative condition is met. */
  complete: boolean
  /** The round's progress has genuinely reached this stage (may still not be actionable -- see Stage 3). */
  reached: boolean
  /** The organiser can genuinely perform this stage's primary action right now. */
  actionable: boolean
  /** Short, human status line for the compact progress tracker. */
  detail: string
  /** Present only for stages with a real primary action (not Stage 2). */
  actionLabel?: string
}

export interface RoundWorkflowInput {
  roundStatus: 'upcoming' | 'active' | 'completed'
  /** Live-play progress, straight from the existing /tournament summary -- unchanged fields, not recalculated. */
  finishedPlayers: number
  totalPlayers: number
  completionPct: number
  awaitingReconciliation: number
  /**
   * The existing Close Round button's own condition, reused verbatim
   * (see TournamentControl.tsx's own `completionPct === 100 &&
   * awaitingReconciliation === 0`) -- never recalculated here, so a
   * future change to that condition only needs changing in one place.
   */
  readyToClose: boolean
  /** From the existing published_round_highlights row for this round. null = no row = not yet reviewed. */
  highlightsPublishedAt: string | null
  /** Approved Option 1's empty-array case -- reviewed, deliberately selected nothing. */
  highlightsSelectedCount: number
  /**
   * Phase D (10 Oct) Task #39 -- optional, real Stage 1 readiness, from
   * deriveStartRoundReadiness() fed by the EXISTING setup-context
   * endpoint (the Begin Round wizard's own data source -- see that
   * function's doc comment). Optional and defaulted to undefined by
   * every existing caller/test, so this is purely additive: when
   * omitted, Stage 1's detail text is exactly what it was before this
   * field existed ("Start when ready"), never a regression.
   */
  startReadiness?: StartRoundReadinessResult | null
  /**
   * Final pre-production gate (10 Oct) -- a loading or failed
   * setup-context fetch (see MyHQClient.tsx) must never be
   * indistinguishable from a confirmed-ready round. When either of
   * these is true, Stage 1's detail text says so explicitly instead
   * of falling back to the same wording a genuinely ready round
   * would show. Both optional and default falsy, so omitting them
   * (every existing caller/test) behaves exactly as before.
   */
  startReadinessLoading?: boolean
  startReadinessError?: boolean
}

export interface RoundWorkflowResult {
  stages: WorkflowStage[]
  /** The single stage (if any) to render as THE primary recommended action. */
  primaryStageId: WorkflowStageId | null
}

export function deriveRoundWorkflow(input: RoundWorkflowInput): RoundWorkflowResult {
  const { roundStatus, finishedPlayers, totalPlayers, completionPct, awaitingReconciliation, readyToClose, highlightsPublishedAt, highlightsSelectedCount, startReadiness, startReadinessLoading, startReadinessError } = input

  const started = roundStatus !== 'upcoming' // active or completed
  const closed = roundStatus === 'completed'
  const highlightsReviewed = highlightsPublishedAt !== null

  const stages: WorkflowStage[] = [
    {
      id: 'start',
      label: 'Start Round',
      complete: started,
      reached: true, // always the floor state
      actionable: !started,
      // Phase D Task #39 -- shows the real blocking issue (from the
      // EXISTING setup-context endpoint, via deriveStartRoundReadiness)
      // when the caller supplies it; otherwise falls back to the
      // original non-claiming wording. Only the single most relevant
      // issue is shown here (compact tracker line) -- the full list
      // stays available on `startReadiness.issues` for any caller that
      // wants it.
      //
      // Final pre-production gate (10 Oct), item 3 -- loading/error are
      // checked BEFORE consulting startReadiness at all, so a stalled
      // or failed fetch can never fall through to "Start when ready"
      // and be misread as a confirmed-ready round. This never blocks
      // the actual Start Round action (that's still just a navigation,
      // validated for real by the Begin Round wizard) -- it only
      // changes which line of text the organiser sees.
      detail: started
        ? 'Round started'
        : startReadinessLoading
          ? 'Checking round readiness…'
          : startReadinessError
            ? 'Could not check round readiness — open Start Round to review setup'
            : (startReadiness && !startReadiness.ready)
              ? startReadiness.issues[0]
              : 'Start when ready',
      actionLabel: 'Start Round',
    },
    {
      id: 'manage',
      label: 'Manage Round',
      complete: closed,
      reached: started,
      // No primary action of its own -- see file-level comment.
      actionable: false,
      detail: !started
        ? 'Not started yet'
        : closed
          ? 'Round complete'
          : awaitingReconciliation > 0
            ? `${awaitingReconciliation} score${awaitingReconciliation === 1 ? '' : 's'} awaiting reconciliation`
            : `${finishedPlayers} of ${totalPlayers} players finished · ${completionPct}% complete`,
    },
    {
      id: 'close',
      label: 'Close Round',
      complete: closed,
      // Reached the moment the round is active -- the approved
      // refinement: Stage 3 must stay visible throughout live play,
      // with a "waiting" explanation, never look skipped or absent.
      reached: started,
      actionable: roundStatus === 'active' && readyToClose,
      detail: closed
        ? 'Round closed'
        : roundStatus !== 'active'
          ? 'Not started yet'
          : readyToClose
            ? 'Ready to close'
            : awaitingReconciliation > 0
              ? 'Waiting for reconciliation'
              : 'Waiting for scoring',
      actionLabel: 'Close Round',
    },
    {
      id: 'makersBreakers',
      label: 'Select Makers & Breakers',
      // Approved Option 1: a row exists (regardless of highlights.length) = reviewed = complete.
      complete: highlightsReviewed,
      reached: closed,
      actionable: closed && !highlightsReviewed,
      detail: !closed
        ? 'Available once the round closes'
        : highlightsReviewed
          ? (highlightsSelectedCount > 0 ? `${highlightsSelectedCount} highlight${highlightsSelectedCount === 1 ? '' : 's'} selected` : 'Reviewed — no highlights selected')
          : 'Ready to review',
      actionLabel: highlightsReviewed ? 'Review Makers & Breakers' : 'Review Makers & Breakers',
    },
    {
      id: 'reviewPresent',
      label: 'Review & Present',
      // Deliberately never "complete" -- a presentation is always
      // optional (approved refinement 1); this stage has no
      // completion gate of any kind.
      complete: false,
      reached: closed,
      actionable: closed,
      detail: !closed ? 'Available once the round closes' : 'Round results and presentation tools are ready',
      actionLabel: 'Create Round Presentation',
    },
  ]

  // Primary-action priority: first stage, in fixed order, that has a
  // real action (excludes 'manage'), is actionable, and isn't already
  // complete. Stage 4 outranks Stage 5 by simply appearing first in
  // this list -- no special-case needed.
  const candidateOrder: WorkflowStageId[] = ['start', 'close', 'makersBreakers', 'reviewPresent']
  const primaryStageId = candidateOrder
    .map(id => stages.find(s => s.id === id)!)
    .find(s => s.actionable && !s.complete)?.id ?? null

  return { stages, primaryStageId }
}

export interface EventProgressInput {
  rounds: { status: 'upcoming' | 'active' | 'completed' }[]
}

export interface EventProgressResult {
  closedCount: number
  totalCount: number
  /** True once every round is 'completed' -- independent of Stage 4/5 for every round, per the approved refinement. */
  allRoundsClosed: boolean
}

export function deriveEventProgress(input: EventProgressInput): EventProgressResult {
  const totalCount = input.rounds.length
  const closedCount = input.rounds.filter(r => r.status === 'completed').length
  return { closedCount, totalCount, allRoundsClosed: totalCount > 0 && closedCount === totalCount }
}

/**
 * Stage 1 readiness -- mirrors the EXACT checks
 * `/api/trips/[tripId]/rounds/[roundId]/start/route.ts` already
 * performs server-side (confirmed by reading that route directly, not
 * assumed): at least one playing group exists, every player is
 * assigned to a group, and every assigned player has a resolvable
 * playing handicap. This does not duplicate or replace that route's
 * own validation -- it's a read-only preview so the organiser can see
 * what's missing from My HQ before opening the Begin Round wizard,
 * using the identical criteria the wizard's own submit will enforce.
 * Hole setup (par/stroke index) is configured interactively inside
 * that wizard itself and isn't data My HQ already has on hand, so it
 * isn't previewed here -- not omitted by oversight, just not
 * duplicated ahead of the one screen that actually collects it.
 */
export interface StartRoundReadinessInput {
  groupCount: number
  assignedPlayerCount: number
  playersMissingHandicap: string[]
}

export interface StartRoundReadinessResult {
  ready: boolean
  issues: string[]
}

export function deriveStartRoundReadiness(input: StartRoundReadinessInput): StartRoundReadinessResult {
  const issues: string[] = []
  if (input.groupCount === 0) issues.push('Assign every player to a playing group before beginning.')
  if (input.assignedPlayerCount === 0) issues.push('No players are assigned to groups yet.')
  if (input.playersMissingHandicap.length > 0) {
    issues.push(`Playing handicap missing for: ${input.playersMissingHandicap.join(', ')}.`)
  }
  return { ready: issues.length === 0, issues }
}
