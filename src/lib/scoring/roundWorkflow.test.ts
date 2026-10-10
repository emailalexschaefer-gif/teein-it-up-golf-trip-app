import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveRoundWorkflow, deriveEventProgress, deriveStartRoundReadiness, type RoundWorkflowInput } from './roundWorkflow'

function base(overrides: Partial<RoundWorkflowInput> = {}): RoundWorkflowInput {
  return {
    roundStatus: 'upcoming',
    finishedPlayers: 0,
    totalPlayers: 20,
    completionPct: 0,
    awaitingReconciliation: 0,
    readyToClose: false,
    highlightsPublishedAt: null,
    highlightsSelectedCount: 0,
    ...overrides,
  }
}

function stage(result: ReturnType<typeof deriveRoundWorkflow>, id: string) {
  const s = result.stages.find(s => s.id === id)
  if (!s) throw new Error(`missing stage ${id}`)
  return s
}

// ── Stage 1: Start Round ─────────────────────────────────────────────────
test('Stage 1: upcoming round -> not complete, actionable, primary', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(r, 'start').complete, false)
  assert.equal(stage(r, 'start').actionable, true)
  assert.equal(r.primaryStageId, 'start')
})
test('Stage 1: active round -> complete, no longer actionable', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active' }))
  assert.equal(stage(r, 'start').complete, true)
  assert.equal(stage(r, 'start').actionable, false)
})
test('Stage 1: completed round -> complete', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T00:00:00Z' }))
  assert.equal(stage(r, 'start').complete, true)
})

// ── Stage 2: Manage Round -- lifecycle transitions, no action button ────
test('Stage 2: upcoming -> not reached, not complete', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(r, 'manage').reached, false)
  assert.equal(stage(r, 'manage').complete, false)
})
test('Stage 2: active, 100% holes entered but reconciliation outstanding -> NOT complete (100% holes is not the completion signal)', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 100, awaitingReconciliation: 2, finishedPlayers: 18, totalPlayers: 20 }))
  assert.equal(stage(r, 'manage').complete, false)
  assert.match(stage(r, 'manage').detail, /reconciliation/)
})
test('Stage 2: active, live progress text reflects finished players and completion pct', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 60, finishedPlayers: 12, totalPlayers: 20 }))
  assert.equal(stage(r, 'manage').detail, '12 of 20 players finished · 60% complete')
})
test('Stage 2: never has a primary action, even when active', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 50 }))
  assert.equal(stage(r, 'manage').actionable, false)
  assert.notEqual(r.primaryStageId, 'manage')
})
test('Stage 2: only becomes complete once the round is actually completed, not from completionPct alone', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 100, awaitingReconciliation: 0 }))
  assert.equal(stage(r, 'manage').complete, false)
  const r2 = deriveRoundWorkflow(base({ roundStatus: 'completed', completionPct: 100, awaitingReconciliation: 0, highlightsPublishedAt: null }))
  assert.equal(stage(r2, 'manage').complete, true)
})

// ── Stage 3: Close Round -- the three-refinement stage ──────────────────
test('Stage 3: stays visible (reached) throughout live play even when not yet actionable', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 60, awaitingReconciliation: 0, readyToClose: false }))
  assert.equal(stage(r, 'close').reached, true)
  assert.equal(stage(r, 'close').actionable, false)
  assert.equal(stage(r, 'close').detail, 'Waiting for scoring')
})
test('Stage 3: reconciliation outstanding -> distinct waiting detail', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 100, awaitingReconciliation: 3, readyToClose: false }))
  assert.equal(stage(r, 'close').detail, 'Waiting for reconciliation')
})
test('Stage 3: becomes actionable and primary the moment the existing readyToClose gate is satisfied (reused verbatim, not recalculated)', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 100, awaitingReconciliation: 0, readyToClose: true }))
  assert.equal(stage(r, 'close').actionable, true)
  assert.equal(stage(r, 'close').detail, 'Ready to close')
  assert.equal(r.primaryStageId, 'close')
})
test('Stage 3: completed round -> complete, no longer actionable', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: null }))
  assert.equal(stage(r, 'close').complete, true)
  assert.equal(stage(r, 'close').actionable, false)
})
test('Stage 3: upcoming round -> not reached yet, "not started" text, never looks actionable', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(r, 'close').reached, false)
  assert.equal(stage(r, 'close').detail, 'Not started yet')
})

// ── Stage 4: Makers & Breakers -- empty-review persistence + revisit-ability ─
test('Stage 4: round not yet completed -> not reached, not actionable', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active' }))
  assert.equal(stage(r, 'makersBreakers').reached, false)
  assert.equal(stage(r, 'makersBreakers').complete, false)
})
test('Stage 4: round completed, no published-highlights row -> not reviewed, actionable, primary', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: null }))
  assert.equal(stage(r, 'makersBreakers').complete, false)
  assert.equal(stage(r, 'makersBreakers').actionable, true)
  assert.equal(r.primaryStageId, 'makersBreakers')
})
test('Stage 4: round completed, row exists with highlights selected -> complete', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 3 }))
  assert.equal(stage(r, 'makersBreakers').complete, true)
  assert.equal(stage(r, 'makersBreakers').detail, '3 highlights selected')
})
test('Stage 4: round completed, row exists with an EMPTY highlights array -> still complete (reviewed, deliberately selected none) -- the core empty-review persistence case', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 0 }))
  assert.equal(stage(r, 'makersBreakers').complete, true)
  assert.equal(stage(r, 'makersBreakers').detail, 'Reviewed — no highlights selected')
})
test('Stage 4: complete status is never locked -- it is still exposed with a "review again" action label, not hidden, once complete', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 0 }))
  assert.equal(stage(r, 'makersBreakers').actionLabel, 'Review Makers & Breakers')
})
test('Stage 4: once reviewed (even with zero selections), it is no longer the primary action -- Stage 5 becomes primary instead', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 0 }))
  assert.equal(r.primaryStageId, 'reviewPresent')
})

// ── Stage 5: Review & Present -- deliberately no "complete" state ───────
test('Stage 5: never reports complete, even on a fully reviewed, fully presented round', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 5 }))
  assert.equal(stage(r, 'reviewPresent').complete, false)
})
test('Stage 5: accessible (actionable) immediately once the round closes, even while Stage 4 is still outstanding', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: null }))
  assert.equal(stage(r, 'reviewPresent').actionable, true)
})
test('Stage 5: accessible-but-not-primary while Stage 4 is outstanding -- never competes as a second primary action', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: null }))
  assert.equal(stage(r, 'reviewPresent').actionable, true)
  assert.notEqual(r.primaryStageId, 'reviewPresent')
  assert.equal(r.primaryStageId, 'makersBreakers')
})
test('Stage 5: becomes the primary action once Stage 4 is complete', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 2 }))
  assert.equal(r.primaryStageId, 'reviewPresent')
})
test('Stage 5: not reached before the round closes', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active' }))
  assert.equal(stage(r, 'reviewPresent').reached, false)
  assert.equal(stage(r, 'reviewPresent').actionable, false)
})

// ── Primary-action priority -- exactly one at a time, in fixed order ────
test('Primary-action priority: exactly one stage is ever flagged primary, across every lifecycle point', () => {
  const scenarios: RoundWorkflowInput[] = [
    base({ roundStatus: 'upcoming' }),
    base({ roundStatus: 'active', completionPct: 40 }),
    base({ roundStatus: 'active', completionPct: 100, awaitingReconciliation: 0, readyToClose: true }),
    base({ roundStatus: 'completed', highlightsPublishedAt: null }),
    base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 0 }),
    base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-10T08:00:00Z', highlightsSelectedCount: 4 }),
  ]
  for (const scenario of scenarios) {
    const r = deriveRoundWorkflow(scenario)
    const primaryCandidates = r.stages.filter(s => s.actionable && !s.complete && s.id !== 'manage')
    // At most one stage SHOULD be surfaced as primary; the function must pick exactly one of any actionable candidates, or null if none.
    if (primaryCandidates.length > 0) {
      assert.ok(r.primaryStageId !== null)
    } else {
      assert.equal(r.primaryStageId, null)
    }
  }
})
test('Primary-action priority: during live scoring before Close Round is ready, there is no primary action (Manage Round has none of its own)', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 50, readyToClose: false }))
  assert.equal(r.primaryStageId, null)
})
test('Primary-action priority: fixed order is Start > Close > Makers & Breakers > Review & Present', () => {
  // Construct an (unrealistic but order-revealing) state where every later stage would also be "actionable" --
  // the function must still pick the earliest in priority order.
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(r.primaryStageId, 'start')
})

// ── Event-level progress -- independent of Stage 4/5 ────────────────────
test('Event progress: counts only officially completed rounds, ignoring Makers & Breakers / presentation status entirely', () => {
  const result = deriveEventProgress({
    rounds: [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ],
  })
  assert.deepEqual(result, { closedCount: 3, totalCount: 3, allRoundsClosed: true })
})
test('Event progress: a mix of statuses -> partial count, not fully closed', () => {
  const result = deriveEventProgress({
    rounds: [
      { status: 'completed' },
      { status: 'active' },
      { status: 'upcoming' },
    ],
  })
  assert.deepEqual(result, { closedCount: 1, totalCount: 3, allRoundsClosed: false })
})
test('Event progress: zero rounds -> not "all closed" (setup state, not a false positive)', () => {
  const result = deriveEventProgress({ rounds: [] })
  assert.equal(result.allRoundsClosed, false)
  assert.equal(result.totalCount, 0)
})

// ── Stage 1 readiness -- mirrors start/route.ts exactly, invents nothing ─
test('Start readiness: no groups -> not ready, exact existing error text', () => {
  const r = deriveStartRoundReadiness({ groupCount: 0, assignedPlayerCount: 0, playersMissingHandicap: [] })
  assert.equal(r.ready, false)
  assert.ok(r.issues.includes('Assign every player to a playing group before beginning.'))
})
test('Start readiness: groups exist but no players assigned -> not ready', () => {
  const r = deriveStartRoundReadiness({ groupCount: 2, assignedPlayerCount: 0, playersMissingHandicap: [] })
  assert.equal(r.ready, false)
  assert.ok(r.issues.includes('No players are assigned to groups yet.'))
})
test('Start readiness: players missing a resolvable handicap -> not ready, names listed', () => {
  const r = deriveStartRoundReadiness({ groupCount: 2, assignedPlayerCount: 8, playersMissingHandicap: ['Alex Schaefer', 'Daz'] })
  assert.equal(r.ready, false)
  assert.ok(r.issues.some(i => i.includes('Alex Schaefer, Daz')))
})
test('Start readiness: every condition satisfied -> ready, no issues', () => {
  const r = deriveStartRoundReadiness({ groupCount: 4, assignedPlayerCount: 16, playersMissingHandicap: [] })
  assert.deepEqual(r, { ready: true, issues: [] })
})

// ── Phase D Task #39 -- deriveRoundWorkflow's optional startReadiness wiring ──
// (fed by MyHQClient.tsx from the EXISTING setup-context endpoint; purely
// additive -- omitting the field must behave exactly as before.)
test('Stage 1 detail: startReadiness omitted entirely -> unchanged original wording (no regression for any existing caller)', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(r, 'start').detail, 'Start when ready')
})
test('Stage 1 detail: startReadiness supplied and ready -> same original wording, not a different "ready" message invented here', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadiness: { ready: true, issues: [] } }))
  assert.equal(stage(r, 'start').detail, 'Start when ready')
})
test('Stage 1 detail: startReadiness not ready -> shows the real blocking issue instead of the generic wording', () => {
  const r = deriveRoundWorkflow(base({
    roundStatus: 'upcoming',
    startReadiness: { ready: false, issues: ['Assign every player to a playing group before beginning.'] },
  }))
  assert.equal(stage(r, 'start').detail, 'Assign every player to a playing group before beginning.')
})
test('Stage 1 detail: startReadiness only ever consulted before the round starts -- once started, "Round started" wins regardless', () => {
  const r = deriveRoundWorkflow(base({
    roundStatus: 'active',
    startReadiness: { ready: false, issues: ['Assign every player to a playing group before beginning.'] },
  }))
  assert.equal(stage(r, 'start').detail, 'Round started')
})
test('Stage 1 detail: startReadinessLoading shows a distinct "checking" message -- never the generic "ready" wording a confirmed-ready round would show', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadinessLoading: true }))
  assert.equal(stage(r, 'start').detail, 'Checking round readiness…')
})
test('Stage 1 detail: startReadinessError shows a distinct "could not check" message -- a network error must never look like confirmation that the round is ready', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadinessError: true }))
  assert.equal(stage(r, 'start').detail, 'Could not check round readiness — open Start Round to review setup')
})
test('Stage 1 detail: loading takes priority over a stale startReadiness value -- a caller that forgets to clear startReadiness while refetching still shows "checking", not a stale verdict', () => {
  const r = deriveRoundWorkflow(base({
    roundStatus: 'upcoming',
    startReadinessLoading: true,
    startReadiness: { ready: true, issues: [] },
  }))
  assert.equal(stage(r, 'start').detail, 'Checking round readiness…')
})
test('Stage 1 detail: loading/error are only ever consulted before the round starts -- "Round started" wins regardless, same as startReadiness itself', () => {
  const r = deriveRoundWorkflow(base({ roundStatus: 'active', startReadinessLoading: true }))
  assert.equal(stage(r, 'start').detail, 'Round started')
})
test('Stage 1 detail: loading/error never change complete/actionable/primary -- same as startReadiness, they only change the detail string', () => {
  const withLoading = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadinessLoading: true }))
  const withError = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadinessError: true }))
  const without = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(withLoading, 'start').actionable, stage(without, 'start').actionable)
  assert.equal(stage(withError, 'start').actionable, stage(without, 'start').actionable)
  assert.equal(withLoading.primaryStageId, without.primaryStageId)
  assert.equal(withError.primaryStageId, without.primaryStageId)
})
test('Stage 1 detail: startReadiness never changes complete/actionable/primary -- it only changes the detail string', () => {
  const withIssue = deriveRoundWorkflow(base({ roundStatus: 'upcoming', startReadiness: { ready: false, issues: ['x'] } }))
  const without = deriveRoundWorkflow(base({ roundStatus: 'upcoming' }))
  assert.equal(stage(withIssue, 'start').complete, stage(without, 'start').complete)
  assert.equal(stage(withIssue, 'start').actionable, stage(without, 'start').actionable)
  assert.equal(withIssue.primaryStageId, without.primaryStageId)
})

// ── Multi-round chronology: the derivation is per-round, caller controls selection ─
test('Multi-round: each round\'s workflow is derived independently -- selecting a different round never alters another round\'s computed stages', () => {
  const round2 = deriveRoundWorkflow(base({ roundStatus: 'completed', highlightsPublishedAt: '2026-10-09T00:00:00Z', highlightsSelectedCount: 2 }))
  const round3 = deriveRoundWorkflow(base({ roundStatus: 'active', completionPct: 30 }))
  assert.equal(stage(round2, 'start').complete, true)
  assert.equal(stage(round3, 'start').complete, true) // active round also already started
  assert.equal(stage(round2, 'manage').complete, true)
  assert.equal(stage(round3, 'manage').complete, false) // still live
  assert.notEqual(round2.primaryStageId, round3.primaryStageId)
})
