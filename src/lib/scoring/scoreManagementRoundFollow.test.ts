import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct) Task #54 -- Score Management now follows My HQ's
 * selected round instead of resolving its own independent default.
 * Confirmed root cause (see AUDIT_REPORT_PHASE_E.md): AdminScoreOverridePanel
 * previously seeded `selectedRoundId` from `rounds.find(active) ??
 * sort-by-play_date-desc[0]`, entirely independent of MyHQClient's own
 * `selected` round, and was mounted as a page-level sibling of
 * MyHQClient rather than a child of it. Both client components have no
 * DOM/React test harness in this project, so -- matching this
 * codebase's established convention -- these are static source-level
 * checks confirming the wiring, plus pure logic checks of the
 * follow/override decision extracted inline where practical.
 */

const here = dirname(fileURLToPath(import.meta.url))
const panelSrc = readFileSync(resolve(here, '../../components/scoring/AdminScoreOverridePanel.tsx'), 'utf8')
const myHqClientSrc = readFileSync(resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8')
const pageSrc = readFileSync(resolve(here, '../../app/(app)/trips/[tripId]/tournament/page.tsx'), 'utf8')

test('AdminScoreOverridePanel is no longer mounted at the page level, independent of My HQ\'s selection', () => {
  assert.ok(!pageSrc.includes('AdminScoreOverridePanel'), 'the page-level mount and its import should be removed')
})

test('AdminScoreOverridePanel is now mounted as a child of MyHQClient, fed the live selected round', () => {
  assert.match(myHqClientSrc, /import AdminScoreOverridePanel from '\.\/AdminScoreOverridePanel'/)
  assert.match(myHqClientSrc, /<AdminScoreOverridePanel/)
  assert.match(myHqClientSrc, /myHqRoundId=\{selected\.id\}/)
  // Still gated the same way page.tsx gated it -- no change to WHEN it
  // shows, only to which round it opens to and where it's mounted.
  assert.match(myHqClientSrc, /rounds\.some\(r => r\.status === 'active' \|\| r\.status === 'completed'\)/)
})

test('the panel accepts an optional myHqRoundId prop and seeds its initial round from it before falling back to the old self-resolving default', () => {
  assert.match(panelSrc, /myHqRoundId\?: string \| null/)
  assert.match(panelSrc, /myHqRoundId \?\? rounds\.find\(r => r\.status === 'active'\)\?\.id \?\? \[\.\.\.rounds\]\.sort/)
})

test('the panel live-follows myHqRoundId via an effect, but only while the organiser has not manually overridden it', () => {
  const effect = panelSrc.match(/useEffect\(\(\) => \{\s*if \(myHqRoundId && !manuallyOverridden[\s\S]*?\n {2}\}, \[myHqRoundId, manuallyOverridden\]\)/)
  assert.ok(effect, 'expected the auto-follow effect')
  assert.match(effect![0], /setSelectedRoundId\(myHqRoundId\)/)
})

test('a manual round pick in the panel\'s own dropdown is tracked as a deliberate override, and picking the My-HQ round again re-arms auto-follow', () => {
  assert.match(panelSrc, /setManuallyOverridden\(!!myHqRoundId && next !== myHqRoundId\)/)
})

test('the dropdown UI labels whether this panel is following My HQ or deliberately viewing a different round -- never silent about which', () => {
  assert.match(panelSrc, /Following the round selected in My HQ above\./)
  assert.match(panelSrc, /Viewing a different round from My HQ above\./)
})

test('the panel still works standalone (myHqRoundId omitted) via its original self-resolving fallback -- the fix is additive, not a hard dependency', () => {
  // The fallback chain after `myHqRoundId ??` is byte-for-byte the
  // original expression this file always had.
  assert.match(panelSrc, /rounds\.find\(r => r\.status === 'active'\)\?\.id \?\? \[\.\.\.rounds\]\.sort\(\(a, b\) => b\.play_date\.localeCompare\(a\.play_date\)\)\[0\]\?\.id \?\? ''/)
})

// -- Phase E (11 Oct) Task #62: Score Management moved a second time,
// out of a standalone page-level section and into Stage 2's own body,
// alongside TournamentControl -- per the user's review confirming it
// was still "another standalone dashboard section beneath the Control
// Centre" rather than genuinely integrated into the Round Control
// Centre. --

test('AdminScoreOverridePanel is no longer mounted as a standalone section outside the Round Control Centre\'s stages', () => {
  // The old standalone mount sat directly inside the top-level
  // `{selected ? (<> ... </>)}` branch, as a sibling of the stage
  // tracker -- not nested inside renderStageBody at all.
  const topLevelBranch = myHqClientSrc.slice(myHqClientSrc.indexOf('{selected ? ('), myHqClientSrc.indexOf('function renderStageBody'))
  assert.ok(!topLevelBranch.includes('<AdminScoreOverridePanel'), 'AdminScoreOverridePanel should no longer be mounted directly in the top-level JSX')
})

test('AdminScoreOverridePanel now mounts inside Stage 2\'s own body ("manage"), directly beneath TournamentControl', () => {
  const manageBranch = (myHqClientSrc.match(/function renderStageBody\(stageId: WorkflowStageId\) \{[\s\S]*?\n    return null\n  \}/)?.[0] ?? '')
    .match(/if \(stageId === 'manage'\) \{[\s\S]*?\n    \}/)
  assert.ok(manageBranch, 'expected to find the "manage" stage branch')
  assert.match(manageBranch![0], /<TournamentControl tripId=\{tripId\} roundId=\{selected\.id\} roundStatus=\{selected\.status\} \/>/)
  assert.match(manageBranch![0], /<AdminScoreOverridePanel/)
  assert.match(manageBranch![0], /myHqRoundId=\{selected\.id\}/)
  // TournamentControl appears before AdminScoreOverridePanel in source
  // order, matching the dashboard-then-score-management layout.
  const tcIndex = manageBranch![0].indexOf('<TournamentControl')
  const panelIndex = manageBranch![0].indexOf('<AdminScoreOverridePanel')
  assert.ok(tcIndex > -1 && panelIndex > -1 && tcIndex < panelIndex)
})

test('the #score-management gating condition is unchanged -- only once a round is active or completed', () => {
  assert.match(myHqClientSrc, /rounds\.some\(r => r\.status === 'active' \|\| r\.status === 'completed'\)/)
  assert.match(myHqClientSrc, /<div id="score-management"/)
})
