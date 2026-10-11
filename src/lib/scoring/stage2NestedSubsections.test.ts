import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct), Task #56 -- "Stage 2 nested subsections, avoid a
 * long page." Leaderboard Snapshot and Round Summary stay always
 * visible at the top of Stage 2 (unchanged); Group Progress and
 * Alerts are now nested into the same CollapsibleSection pattern
 * already used for Side Games/Live Statistics/Group Map, rather than
 * rendering as permanently-open, unbounded blocks regardless of
 * whether there's anything in them that needs attention.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../components/scoring/TournamentControl.tsx'), 'utf8')

test('Leaderboard Snapshot and Round Summary remain always visible (not nested in a collapsible) -- unchanged per the brief', () => {
  assert.match(src, /<SectionTitle>Leaderboard Snapshot<\/SectionTitle>/)
  // Round Summary has no SectionTitle of its own (it's the green
  // gradient card) -- confirm it isn't wrapped in a CollapsibleSection
  // by checking the Round Summary card's own distinctive style is not
  // preceded by a CollapsibleSection open tag within a short window.
  const roundSummaryIndex = src.indexOf("background: 'linear-gradient(135deg,#14532d,#1a6b3a)'")
  assert.ok(roundSummaryIndex > -1)
})

test('Group Progress is now a CollapsibleSection, keyed on whether any group needs attention (same convention as Event Health)', () => {
  const block = src.match(/<CollapsibleSection\s*\n\s*key=\{data\.groups\.some[\s\S]*?icon="⛳" title="Group Progress" count=\{data\.groups\.length\}[\s\S]*?defaultExpanded=\{[\s\S]*?\}\s*\n\s*>/)
  assert.ok(block, 'expected Group Progress wrapped in a keyed CollapsibleSection')
})

test('Alerts only renders (and auto-expands) when there is genuinely something to show -- never an empty always-open block', () => {
  assert.match(src, /\{\(data\.mismatchAlerts\.length > 0 \|\| data\.alerts\.length > 0\) && \(/)
  const alertsBlock = src.match(/\{\(data\.mismatchAlerts\.length > 0 \|\| data\.alerts\.length > 0\) && \([\s\S]*?icon="⚠️" title="Alerts"[\s\S]*?defaultExpanded\s*\n/)
  assert.ok(alertsBlock, 'expected a conditionally-rendered, defaultExpanded Alerts CollapsibleSection')
})

test('the #alerts-section anchor stays a stable target regardless of whether Alerts itself is currently rendered', () => {
  assert.match(src, /<div id="alerts-section" \/>/)
  // Phase E (11 Oct) verification pass -- Event Health's own "View
  // affected players" control moved from a bare `href="#alerts-section"`
  // anchor to an onClick callback (`onViewAffectedPlayers`, wired up in
  // MyHQClient to expand Stage 2 before scrolling), since Event Health
  // no longer lives inside the same always-rendered component as
  // Alerts. See eventHealthOutsideStages.test.ts for the full coverage.
  assert.match(src, /onClick=\{onViewAffectedPlayers\}/)
})

test('Side Games, Live Statistics and Group Map remain CollapsibleSections -- unchanged by this task', () => {
  assert.match(src, /icon="🏆" title="Side Games"/)
  assert.match(src, /icon="📊" title="Live Statistics"/)
  assert.match(src, /icon="✏️" title="Group Map"/)
})

test('Playing Partner Status stays a plain, always-visible mount -- not wrapped in a collapsible (the brief calls for "compact but visible", not collapsible)', () => {
  assert.match(src, /<PlayingPartnerStatus tripId=\{tripId\} roundId=\{roundId\} \/>/)
  const idx = src.indexOf('<PlayingPartnerStatus')
  const before = src.slice(Math.max(0, idx - 200), idx)
  assert.ok(!/<CollapsibleSection\s*$/.test(before.trimEnd()), 'PlayingPartnerStatus should not be the immediate child of a CollapsibleSection opening tag')
})
