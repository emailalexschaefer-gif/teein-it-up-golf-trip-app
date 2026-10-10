import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * My HQ V2 (10 Oct), Stage 4 fix — static source-level regression
 * tests. The two components this fix touches
 * (RoundHighlightsSection.tsx, MakersBreakers.tsx) are client
 * components built on hooks, fetch and JSX with no DOM/React test
 * harness set up in this project, so — matching this codebase's own
 * existing convention for this kind of fix (see
 * src/lib/trips/messagesNullablePlayerIdFix.test.ts) — these assert
 * directly against the source text: that the old collapsing bug is
 * gone, and that the new behaviour (distinguishing "not reviewed" from
 * "reviewed, selected nothing," plus the explicit Finish/Skip and Edit
 * affordances) is present.
 */

const here = dirname(fileURLToPath(import.meta.url))
const roundHighlightsSectionSrc = readFileSync(
  resolve(here, '../../components/scoring/RoundHighlightsSection.tsx'), 'utf8',
)
const makersBreakersSrc = readFileSync(
  resolve(here, '../../components/scoring/MakersBreakers.tsx'), 'utf8',
)

test('RoundHighlightsSection: no longer collapses "no row" and "row with empty highlights" into the same hidden outcome', () => {
  assert.ok(
    !roundHighlightsSectionSrc.includes('!data?.publishedAt || data.highlights.length === 0'),
    'the old collapsing condition must be gone',
  )
})

test('RoundHighlightsSection: the hide condition now checks publishedAt alone', () => {
  assert.match(roundHighlightsSectionSrc, /if \(!data\?\.publishedAt\) return null/)
})

test('RoundHighlightsSection: renders a distinct "reviewed, selected nothing" message rather than hiding', () => {
  assert.match(roundHighlightsSectionSrc, /Reviewed — no highlights selected/)
})

test('MakersBreakers: has an explicit Skip/Finish-with-nothing action, distinct from the normal publish', () => {
  assert.match(makersBreakersSrc, /async function skipReview/)
  assert.match(makersBreakersSrc, /doPublish\(\[\]\)/)
})

test('MakersBreakers: the skip action is reachable from the curating screen regardless of candidate count', () => {
  assert.match(makersBreakersSrc, /skipReview\(\)/)
  assert.match(makersBreakersSrc, /don't select any highlights for this round/)
})

test('MakersBreakers: a published review can be reopened and edited, not permanently locked', () => {
  assert.match(makersBreakersSrc, /async function startEditingPublished/)
  assert.match(makersBreakersSrc, /Edit Selection/)
})

test('MakersBreakers: editing a published review pre-selects the currently published categories, never starting from a blank slate', () => {
  assert.match(makersBreakersSrc, /new Set\(\(publishedHighlights \?\? \[\]\)\.map\(h => h\.category\)\)/)
})

test('MakersBreakers: no write happens merely from opening the screen -- the only POST call sites are inside doPublish, reached only via publish()/skipReview()', () => {
  const postCallSites = makersBreakersSrc.match(/method: 'POST'/g) ?? []
  assert.equal(postCallSites.length, 1, 'expected exactly one POST call site (inside doPublish)')
})

test('MakersBreakers: the initial mount effect only ever reads (GET) -- never a POST -- before any organiser action', () => {
  const effectMatch = makersBreakersSrc.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[tripId, roundId\]\)/)
  assert.ok(effectMatch, 'expected to find the mount effect')
  assert.ok(!effectMatch![0].includes("method: 'POST'"), 'mount effect must never POST')
})

/**
 * Phase D verification (10 Oct) — this component manages its own
 * published-highlights state via a plain fetch, entirely outside React
 * Query. A successful publish/skip/edit-republish must invalidate the
 * SAME query key RoundHighlightsSection.tsx and My HQ's own Guided
 * Workflow tracker already read via useQuery
 * (['published-highlights', tripId, roundId], this app's 60s default
 * staleTime) — otherwise those two consumers can show stale "not yet
 * reviewed" or stale highlights for up to a minute after the organiser
 * genuinely finishes a review, including after navigating away (within
 * the same mount) and back.
 */
test('MakersBreakers: imports React Query\'s useQueryClient to invalidate the shared cache on publish', () => {
  assert.match(makersBreakersSrc, /import \{ useQueryClient \} from '@tanstack\/react-query'/)
  assert.match(makersBreakersSrc, /const queryClient = useQueryClient\(\)/)
})

test('MakersBreakers: doPublish invalidates the exact query key RoundHighlightsSection/My HQ already read, on every successful publish (first-time, Skip, or Edit-republish alike)', () => {
  assert.match(
    makersBreakersSrc,
    /queryClient\.invalidateQueries\(\{ queryKey: \['published-highlights', tripId, roundId\] \}\)/,
  )
  // All three write paths (publish(), skipReview(), and a re-publish
  // from startEditingPublished()'s curating flow) share the one
  // doPublish() function -- confirming the invalidation call sits
  // inside doPublish, not duplicated per call site, is what guarantees
  // all three are covered by this one line.
  const doPublishBody = makersBreakersSrc.match(/async function doPublish\(highlights: Highlight\[\]\): Promise<boolean> \{[\s\S]*?\n {2}\}/)
  assert.ok(doPublishBody, 'expected to find doPublish')
  assert.match(doPublishBody![0], /invalidateQueries/)
})
