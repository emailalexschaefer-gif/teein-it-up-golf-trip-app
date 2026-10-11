import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct) verification pass -- user review confirmed a real
 * regression in Task #55: Event Health rendered inside TournamentControl,
 * which Task #55 made mount only inside Stage 2's own expandable body.
 * So "Event Health is unconditional inside TournamentControl" (true)
 * did NOT mean "visible regardless of which stage is expanded" (false)
 * once TournamentControl's own MOUNTING became stage-gated. Fixed by
 * extracting EventHealthSection and mounting it directly from
 * MyHQClient, between Event Progress and the Round Control Centre
 * tracker -- genuinely outside the five-stage component tree.
 */

const here = dirname(fileURLToPath(import.meta.url))
const tournamentControlSrc = readFileSync(resolve(here, '../../components/scoring/TournamentControl.tsx'), 'utf8')
const myHqClientSrc = readFileSync(resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8')

test('TournamentControl no longer renders Event Health itself -- only exports EventHealthSection for the caller to mount elsewhere', () => {
  // TournamentControl's own main return (everything after `export
  // default function TournamentControl`) should contain no Event
  // Health CollapsibleSection of its own.
  const ownReturn = tournamentControlSrc.slice(tournamentControlSrc.indexOf('export default function TournamentControl'), tournamentControlSrc.indexOf('export function EventHealthSection'))
  assert.ok(!/icon="🩺" title="Event Health"/.test(ownReturn), 'TournamentControl itself should no longer render an Event Health CollapsibleSection')
  assert.match(tournamentControlSrc, /export function EventHealthSection\(/)
})

test('MyHQClient mounts EventHealthSection directly, between Event Progress and the Round Control Centre tracker -- genuinely outside all five stages', () => {
  const idx = myHqClientSrc.indexOf('<EventHealthSection')
  assert.ok(idx > -1, 'expected EventHealthSection to be mounted directly in MyHQClient')
  const progressIdx = myHqClientSrc.indexOf('<EventProgressBadge')
  const trackerIdx = myHqClientSrc.indexOf('<RoundWorkflowTracker')
  assert.ok(progressIdx > -1 && trackerIdx > -1)
  assert.ok(progressIdx < idx && idx < trackerIdx, 'EventHealthSection should sit between Event Progress and the stage tracker')
})

test('EventHealthSection is not nested inside renderStageBody -- it is not part of any stage\'s conditionally-mounted content', () => {
  const renderStageBodySrc = myHqClientSrc.match(/function renderStageBody\(stageId: WorkflowStageId\) \{[\s\S]*?\n    return null\n  \}/)?.[0] ?? ''
  assert.ok(!renderStageBodySrc.includes('EventHealthSection'), 'Event Health must not be reachable only through a stage\'s own expand state')
})

test('EventHealthSection reads the already-shared tournament query cache -- no second fetch, no duplicated health calculation', () => {
  assert.match(myHqClientSrc, /health=\{workflowTournamentData\.health\}/)
  assert.match(myHqClientSrc, /mismatchCount=\{workflowTournamentData\.mismatchAlerts\.length\}/)
})

test('"View affected players" now expands Stage 2 before scrolling to the Alerts anchor, since Alerts lives inside Stage 2\'s conditionally-mounted body', () => {
  const handler = myHqClientSrc.match(/onViewAffectedPlayers=\{\(\) => \{[\s\S]*?\n            \}\}/)
  assert.ok(handler, 'expected an onViewAffectedPlayers handler')
  assert.match(handler![0], /setExpandedStages\(prev => new Set\(\[\.\.\.prev, 'manage'\]\)\)/)
  assert.match(handler![0], /scrollIntoView/)
})
