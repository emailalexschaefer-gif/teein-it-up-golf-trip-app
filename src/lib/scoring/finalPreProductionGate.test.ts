import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * My HQ V2 — Final Pre-Production Verification Gate (10 Oct), per the
 * Phase D review's three targeted verification items. Each of
 * TournamentControl.tsx, the Memories page, and MyHQClient.tsx is a
 * client component with no DOM/React test harness in this project, so
 * -- matching this codebase's own established convention (see
 * makersBreakersStage4Fix.test.ts, stage5SlideshowDeepLink.test.ts,
 * startRoundReadinessWiring.test.ts) -- these are static source-level
 * checks.
 */

const here = dirname(fileURLToPath(import.meta.url))
const tournamentControlSrc = readFileSync(
  resolve(here, '../../components/scoring/TournamentControl.tsx'), 'utf8',
)
const memoriesPageSrc = readFileSync(
  resolve(here, '../../app/(app)/trips/[tripId]/memories/page.tsx'), 'utf8',
)
const myHqClientSrc = readFileSync(
  resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8',
)

// ── Item 1: Event Health reactivity ─────────────────────────────────────
test('Event Health: CollapsibleSection is keyed on the health bucket, not just given a static defaultExpanded -- so a green->non-green transition while mounted forces a re-seed instead of being silently missed', () => {
  const block = tournamentControlSrc.match(/<CollapsibleSection\s*\n\s*key=\{data\.health\.level[\s\S]*?defaultExpanded=\{data\.health\.level !== 'green'\}/)
  assert.ok(block, 'expected the Event Health CollapsibleSection to carry a health-bucket key alongside defaultExpanded')
  assert.match(block![0], /key=\{data\.health\.level !== 'green' \? 'health-warn' : 'health-ok'\}/)
})
test('Event Health: the key buckets gold and red together -- a fluctuation within the same non-green severity never forces an unnecessary remount/reset', () => {
  // Only two possible key values exist for this element -- confirmed by
  // the exact ternary text above, not a separate per-level key -- so
  // 'gold' and 'red' always share 'health-warn'.
  assert.match(tournamentControlSrc, /key=\{data\.health\.level !== 'green' \? 'health-warn' : 'health-ok'\}/)
})

// ── Item 2: Slideshow deep link robustness ──────────────────────────────
test('Slideshow deep link: the effect is gated on the manifest being loaded, so a direct page load (no My HQ referrer) still resolves it once data arrives, not only on a client-side navigation', () => {
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect, 'expected to find the deep-link effect')
  assert.match(deepLinkEffect![0], /if \(deepLinkHandled \|\| !manifest\) return/)
})
test('Slideshow deep link: deepLinkHandled is set exactly once, unconditionally, before either branch runs -- re-renders (manifest refetch, unrelated state changes) can never re-trigger a second automatic launch', () => {
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect)
  // setDeepLinkHandled(true) now fires exactly once, before the
  // event/round branch split -- not duplicated per-branch -- so the
  // early-return guard above is armed the instant a recognised param
  // is seen, before chooseScope or the URL cleanup even run.
  const occurrences = deepLinkEffect![0].split('setDeepLinkHandled(true)').length - 1
  assert.equal(occurrences, 1, 'expected setDeepLinkHandled(true) exactly once')
  assert.match(deepLinkEffect![0], /if \(startSlideshow !== 'event' && startSlideshow !== 'round'\) return\s*\n\s*setDeepLinkHandled\(true\)/)
})
test('Slideshow deep link: an invalid/unmatched roundId never calls chooseScope at all -- it is still marked handled and the URL still cleaned up, so it degrades to the ordinary picker rather than retrying or erroring on every render', () => {
  assert.match(memoriesPageSrc, /const roundExists = !!roundId && manifest\.rounds\.some\(r => r\.id === roundId\)/)
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect)
  assert.match(deepLinkEffect![0], /if \(roundExists\) chooseScope\(\{ kind: 'round', roundId: roundId! \}\)/)
})
test('Slideshow deep link: once consumed, the startSlideshow/roundId params are stripped from the URL via router.replace -- so a later page refresh or restored tab on the same URL never silently re-launches the slideshow again', () => {
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect)
  assert.match(deepLinkEffect![0], /router\.replace\(pathname, \{ scroll: false \}\)/)
  // The cleanup runs right after the handled flag is set and before
  // either branch -- so it happens whether the deep link actually
  // opens the slideshow or silently falls through on an invalid round.
  const handledIdx = deepLinkEffect![0].indexOf('setDeepLinkHandled(true)')
  const cleanupIdx = deepLinkEffect![0].indexOf('router.replace(pathname')
  const eventBranchIdx = deepLinkEffect![0].indexOf("chooseScope({ kind: 'fullEvent' })")
  assert.ok(handledIdx < cleanupIdx && cleanupIdx < eventBranchIdx, 'expected: set handled -> clean URL -> branch logic, in that order')
})
test('Slideshow deep link: router.replace is used, never router.push, so consuming the deep link does not add its own extra browser-back entry', () => {
  assert.ok(!memoriesPageSrc.includes("router.push(pathname"), 'must not push a redundant history entry for the cleanup')
  assert.match(memoriesPageSrc, /router\.replace\(pathname, \{ scroll: false \}\)/)
})
test('Slideshow deep link: returning from the slideshow (closing it) never re-reads the query params -- deepLinkHandled already latched true, so chooseScope is not called a second time on the way back to the picker', () => {
  // The effect's dependency array is exactly [manifest, deepLinkHandled]
  // -- it does not depend on slideshowStep, so closing the slideshow
  // (which changes slideshowStep, not manifest/deepLinkHandled) cannot
  // re-run this effect at all.
  assert.match(memoriesPageSrc, /\}, \[manifest, deepLinkHandled\]\)/)
})

// ── Item 3: Start Round readiness -- loading/error states ───────────────
test('Start Round readiness: a failed setup-context fetch never silently reports ready -- deriveStartRoundReadiness is only fed real data, and the raw query error/loading state is surfaced instead of defaulting to a ready-looking empty readiness', () => {
  assert.match(myHqClientSrc, /isLoading: setupContextLoading, isError: setupContextError/)
  assert.match(myHqClientSrc, /const startReadiness = setupContextData \? deriveStartRoundReadiness/)
})
test('Start Round readiness: the loading/error flags are threaded into deriveRoundWorkflow so Stage 1\'s detail text can distinguish "still checking" / "couldn\'t check" from an actual confirmed blocker', () => {
  assert.match(myHqClientSrc, /const startReadinessLoading = !!selected && selected\.status === 'upcoming' && setupContextLoading/)
  assert.match(myHqClientSrc, /const startReadinessError = !!selected && selected\.status === 'upcoming' && setupContextError/)
  assert.match(myHqClientSrc, /startReadinessLoading,\s*\n\s*startReadinessError,/)
})
test('Start Round readiness: the Begin Round wizard remains the authoritative validator -- this preview never gates the actual Start Round navigation action', () => {
  assert.match(myHqClientSrc, /if \(stageId === 'start'\) \{ router\.push\(`\/trips\/\$\{tripId\}\?tab=rounds`\); return \}/)
})
