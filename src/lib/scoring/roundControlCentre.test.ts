import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct), Task #55 -- "Build expandable five-stage Round
 * Control Centre." RoundWorkflowTracker renamed from "Guided Workflow"
 * to "Round Control Centre" (dynamic per round name) and each of its
 * five stage rows is now independently expandable, with real embedded
 * content supplied by MyHQClient's renderStageBody -- TournamentControl
 * (Stage 2/3), RoundHighlightsCard + RoundHighlightsSection (Stage 4,
 * consolidated from two previously scattered entry points), and
 * EventStorySection + EventMemoriesCard (Stage 5, moved out of
 * TournamentControl's own tail where they rendered unconditionally).
 * No DOM/React test harness exists for these client components in this
 * project -- these are static source-level checks, matching this
 * codebase's established convention for exactly this class of component.
 */

const here = dirname(fileURLToPath(import.meta.url))
const trackerSrc = readFileSync(resolve(here, '../../components/scoring/RoundWorkflowTracker.tsx'), 'utf8')
const myHqClientSrc = readFileSync(resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8')
const tournamentControlSrc = readFileSync(resolve(here, '../../components/scoring/TournamentControl.tsx'), 'utf8')

// Both handleWorkflowAction and renderStageBody branch on the same
// `if (stageId === '...')` stage ids, so a bare regex match against
// the whole file can accidentally land in the wrong function. Extract
// each function's own body text first, then search within it.
const renderStageBodySrc = myHqClientSrc.match(/function renderStageBody\(stageId: WorkflowStageId\) \{[\s\S]*?\n    return null\n  \}/)?.[0] ?? ''
const handleWorkflowActionSrc = myHqClientSrc.match(/function handleWorkflowAction\(stageId: WorkflowStageId\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert.ok(renderStageBodySrc, 'expected to find renderStageBody in MyHQClient.tsx')
assert.ok(handleWorkflowActionSrc, 'expected to find handleWorkflowAction in MyHQClient.tsx')

test('the tracker is renamed to "Round Control Centre", dynamic per round name -- the old label is no longer actually rendered', () => {
  // An explanatory comment may still mention the old name in prose
  // (documenting the rename); only the actual rendered JSX matters.
  assert.ok(!/\{roundName\} — Guided Workflow/.test(trackerSrc), 'the old label should no longer be rendered')
  assert.match(trackerSrc, /\{roundName\} — Round Control Centre/)
})

test('the tracker is a controlled, purely presentational component -- expand state and stage bodies come from the caller, not owned internally', () => {
  assert.ok(!/useState/.test(trackerSrc), 'RoundWorkflowTracker should own no state of its own (controlled component)')
  assert.match(trackerSrc, /expandedStages: Set<WorkflowStageId>/)
  assert.match(trackerSrc, /onToggleStage: \(stageId: WorkflowStageId\) => void/)
  assert.match(trackerSrc, /renderBody\?: \(stageId: WorkflowStageId\) => ReactNode/)
})

test('each stage row has its own expand/collapse toggle, and expanded content renders only while that stage is expanded', () => {
  assert.match(trackerSrc, /onClick=\{\(\) => onToggleStage\(stage\.id\)\}/)
  assert.match(trackerSrc, /isExpanded && body != null/)
})

test('the existing primary/accessible action buttons and the "Review again" link are preserved unchanged -- one prominent primary action per stage, as before', () => {
  assert.match(trackerSrc, /state === 'primary' && stage\.actionLabel/)
  assert.match(trackerSrc, /state === 'accessible' && stage\.actionLabel/)
  assert.match(trackerSrc, /Review again/)
})

test('MyHQClient auto-expands the current actionable stage once per round selection, not on every data refresh', () => {
  const effect = myHqClientSrc.match(/useEffect\(\(\) => \{\s*if \(selected && workflow\?\.primaryStageId && autoOpenedForRound\.current !== selected\.id\)[\s\S]*?\n  \}, \[selected\?\.id, workflow\?\.primaryStageId\]\)/)
  assert.ok(effect, 'expected a once-per-round auto-expand effect guarded by a ref, not re-run on every poll')
  assert.match(effect![0], /setExpandedStages\(new Set\(\[workflow\.primaryStageId\]\)\)/)
  assert.match(effect![0], /autoOpenedForRound\.current = selected\.id/)
})

test('RoundWorkflowTracker is mounted with the new controlled props wired to MyHQClient\'s own state and renderStageBody', () => {
  assert.match(myHqClientSrc, /expandedStages=\{expandedStages\}/)
  assert.match(myHqClientSrc, /onToggleStage=\{toggleStage\}/)
  assert.match(myHqClientSrc, /renderBody=\{renderStageBody\}/)
})

test('Stage "manage" embeds the real, unmodified TournamentControl -- no longer rendered unconditionally at the page level', () => {
  const manageBranch = renderStageBodySrc.match(/if \(stageId === 'manage'\) \{[\s\S]*?\n    \}/)
  assert.ok(manageBranch)
  assert.match(manageBranch![0], /<TournamentControl tripId=\{tripId\} roundId=\{selected\.id\} roundStatus=\{selected\.status\} \/>/)
  // The old always-visible mount, directly inside the `selected ? (` branch
  // with no stageId gating, should be gone.
  assert.ok(!/\{selected \? \(\s*<>\s*<TournamentControl/.test(myHqClientSrc), 'TournamentControl should no longer be mounted unconditionally at the top level')
})

test('Stage "close" gives an honest status + jump into Stage 2\'s embedded Close Round control, rather than a second, state-duplicating mount', () => {
  const closeBranch = renderStageBodySrc.match(/if \(stageId === 'close'\) \{[\s\S]*?\n    \}/)
  assert.ok(closeBranch)
  assert.match(closeBranch![0], /handleWorkflowAction\('close'\)/)
})

test('handleWorkflowAction(\'close\') expands both Stage 2 and Stage 3 before scrolling to the embedded Close Round control', () => {
  const branch = handleWorkflowActionSrc.match(/if \(stageId === 'close'\) \{\s*setExpandedStages\(prev => new Set\(\[\.\.\.prev, 'manage', 'close'\]\)\)[\s\S]*?\n    \}/)
  assert.ok(branch, 'expected the close action to expand manage+close before scrolling')
  assert.match(branch![0], /scrollIntoView/)
})

test('Stage "makersBreakers" consolidates RoundHighlightsCard and RoundHighlightsSection into one body', () => {
  const branch = renderStageBodySrc.match(/if \(stageId === 'makersBreakers'\) \{[\s\S]*?\n    \}/)
  assert.ok(branch)
  assert.match(branch![0], /<RoundHighlightsCard tripId=\{tripId\} roundId=\{selected\.id\} roundName=\{selected\.name\} \/>/)
  assert.match(branch![0], /<RoundHighlightsSection tripId=\{tripId\} roundId=\{selected\.id\} roundName=\{selected\.name\} \/>/)
})

test('the old standalone Makers & Breakers anchor/card at the My HQ page level is gone', () => {
  assert.ok(!myHqClientSrc.includes('makers-breakers-section'), 'the old external scroll anchor should no longer exist')
})

test('Stage "reviewPresent" embeds Event Story and Event Memories, reading `story` from the already-shared tournament query cache (no second fetch)', () => {
  const branch = renderStageBodySrc.match(/if \(stageId === 'reviewPresent'\) \{[\s\S]*?\n    \}/)
  assert.ok(branch)
  assert.match(branch![0], /<EventStorySection tripId=\{tripId\} golfStory=\{workflowTournamentData\?\.story \?\? \[\]\} \/>/)
  assert.match(branch![0], /<EventMemoriesCard tripId=\{tripId\} \/>/)
})

test('TournamentControl no longer imports or renders RoundHighlightsSection or EventMemoriesCard -- both relocated to MyHQClient', () => {
  assert.ok(!tournamentControlSrc.includes("from './RoundHighlightsSection'"))
  assert.ok(!tournamentControlSrc.includes("from './EventMemoriesCard'"))
  assert.ok(!/<RoundHighlightsSection/.test(tournamentControlSrc))
  assert.ok(!/<EventMemoriesCard/.test(tournamentControlSrc))
})

test('TournamentControl exports EventStorySection and StoryEntry so MyHQClient can embed them in Stage 5', () => {
  assert.match(tournamentControlSrc, /export function EventStorySection/)
  assert.match(tournamentControlSrc, /export interface StoryEntry/)
})

test('MyHQClient imports EventStorySection/StoryEntry from TournamentControl rather than duplicating the component', () => {
  // Phase E (11 Oct) verification pass -- this import line also grew
  // EventHealthSection/EventHealthInfo (see eventHealthOutsideStages.test.ts).
  assert.match(myHqClientSrc, /import TournamentControl, \{ EventStorySection, EventHealthSection, type StoryEntry, type EventHealthInfo \} from '\.\/TournamentControl'/)
})

test('Event Health stays unconditional inside TournamentControl -- not nested inside any stage-specific branch, so it is visible regardless of which stage is expanded', () => {
  const eventHealthIndex = tournamentControlSrc.indexOf('icon="🩺" title="Event Health"')
  assert.ok(eventHealthIndex > -1, 'Event Health section should still exist')
  // It should appear directly inside the component's single top-level
  // return, not behind an `if (stageId === ...)`-style conditional --
  // TournamentControl itself takes no stageId prop at all.
  assert.ok(!tournamentControlSrc.includes('stageId'), 'TournamentControl should not have been given stage-specific branching of its own')
})

test('Stage 1 embedded setup summary reuses the already-fetched setupContextData/startReadiness -- no new query introduced', () => {
  const branch = renderStageBodySrc.match(/if \(stageId === 'start'\) \{[\s\S]*?\n    \}\n\n    if \(stageId === 'manage'\)/)
  assert.ok(branch)
  assert.match(branch![0], /setupContextData/)
  assert.ok(!/useQuery/.test(branch![0]), 'Stage 1\'s body should not declare a new query of its own')
})
