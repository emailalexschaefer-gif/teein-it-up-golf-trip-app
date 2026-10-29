import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSetupModel, type SetupInput, type SetupEntryState } from './setupModel'

const entry = (o: Partial<SetupEntryState> = {}): SetupEntryState => ({ entryId: 'e1', teamName: 'Team 1', memberCount: 4, expectedSize: 4, scorerConfirmed: true, handicapLocked: false, ...o })
const base = (o: Partial<SetupInput> = {}): SetupInput => ({ formatConfigured: true, expectedSize: 4, unassignedPlayerCount: 0, unsavedSuggestionCount: 0,
  entries: [entry()], handicapApproved: false, roundReleased: false, acceptedScoresExist: false, ...o })
const step = (m: ReturnType<typeof buildSetupModel>, k: string) => m.steps.find(s => s.key === k)!

test('ready: teams saved, scorer confirmed, handicaps blocked but gross scoring can start', () => {
  const m = buildSetupModel(base())
  assert.equal(m.canStartScoring, true); assert.deepEqual(m.blockers, [])
  assert.equal(step(m, 'handicaps').status, 'blocked'); assert.match(step(m, 'handicaps').detail, /Gross scoring is available/)
})
test('format not chosen blocks everything', () => {
  const m = buildSetupModel(base({ formatConfigured: false, entries: [] }))
  assert.equal(m.canStartScoring, false); assert.deepEqual(m.blockers, ['Choose the Ambrose format.'])
})
test('unassigned players or unsaved suggestions block with a plain count', () => {
  assert.match(buildSetupModel(base({ unassignedPlayerCount: 1 })).blockers[0], /1 player is not on a team/)
  assert.match(buildSetupModel(base({ unassignedPlayerCount: 3 })).blockers[0], /3 players are not on a team/)
  assert.match(buildSetupModel(base({ unsavedSuggestionCount: 2 })).blockers[0], /2 suggested teams not saved/)
})
test('wrong team size blocks (no padding of incomplete teams)', () => {
  const m = buildSetupModel(base({ entries: [entry({ memberCount: 3 })] }))
  assert.equal(m.canStartScoring, false); assert.match(m.blockers[0], /does not have exactly 4 players/)
})
test('a team with no confirmed scorer blocks starting', () => {
  const m = buildSetupModel(base({ entries: [entry(), entry({ entryId: 'e2', scorerConfirmed: false })] }))
  assert.equal(m.canStartScoring, false); assert.ok(m.blockers.some(b => /1 team has no confirmed scorer/.test(b)))
})
test('withdrawn teams are ignored for readiness', () => {
  const m = buildSetupModel(base({ entries: [entry(), entry({ entryId: 'e2', scorerConfirmed: false, memberCount: 2, withdrawn: true })] }))
  assert.equal(m.canStartScoring, true)
})
test('no teams at all cannot start', () => {
  assert.equal(buildSetupModel(base({ entries: [] })).canStartScoring, false)
})
test('already released cannot be started again; accepted scores lock team editing', () => {
  const m = buildSetupModel(base({ roundReleased: true, acceptedScoresExist: true }))
  assert.equal(m.canStartScoring, false); assert.equal(m.teamsEditable, false); assert.match(m.teamsLockReason!, /audited correction/)
  assert.equal(buildSetupModel(base()).teamsEditable, true)
})
test('when handicaps are approved the step requires every team locked', () => {
  assert.equal(step(buildSetupModel(base({ handicapApproved: true })), 'handicaps').status, 'todo')
  assert.equal(step(buildSetupModel(base({ handicapApproved: true, entries: [entry({ handicapLocked: true })] })), 'handicaps').status, 'done')
})

test('a released round freezes team set-up; reopen is offered only before any score; relock after reopening', () => {
  const rel = buildSetupModel(base({ roundReleased: true }))
  assert.equal(rel.teamsEditable, false); assert.equal(rel.canReopen, true); assert.equal(rel.canRelock, false); assert.match(rel.teamsLockReason!, /Reopen it/)
  const re = buildSetupModel(base({ roundReleased: true, setupReopened: true }))
  assert.equal(re.teamsEditable, true); assert.equal(re.canReopen, false); assert.equal(re.canRelock, true)
  const scored = buildSetupModel(base({ roundReleased: true, setupReopened: true, acceptedScoresExist: true }))
  assert.equal(scored.teamsEditable, false); assert.equal(scored.canReopen, false)
})
test('Ambrose never starts scoring from the set-up screen: it only points at My HQ', () => {
  assert.match(buildSetupModel(base()).startHandOff, /My HQ/)
  assert.match(buildSetupModel(base({ roundReleased: true })).startHandOff, /My HQ/)
})
