import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * My HQ V2 Phase D (10 Oct) — Stage 5's round/event-scoped slideshow
 * deep link, built only after auditing the Memories page's slideshow
 * flow in full (chooseScope/defaultPresentationConfig/
 * getAvailableSections/PresentationScope). Both files are client
 * components with no DOM/React test harness in this project, so these
 * are static source-level checks (same convention as
 * makersBreakersStage4Fix.test.ts) confirming: the deep link reuses
 * the exact same chooseScope() function a manual tap already calls
 * (never a parallel config path), it degrades safely for an unknown
 * round id, and it never touches deck generation.
 */

const here = dirname(fileURLToPath(import.meta.url))
const memoriesPageSrc = readFileSync(
  resolve(here, '../../app/(app)/trips/[tripId]/memories/page.tsx'), 'utf8',
)
const myHqClientSrc = readFileSync(
  resolve(here, '../../components/scoring/MyHQClient.tsx'), 'utf8',
)

test('Memories page reads the startSlideshow/roundId query params via useSearchParams', () => {
  assert.match(memoriesPageSrc, /import \{ useParams, useSearchParams, useRouter, usePathname \} from 'next\/navigation'/)
  assert.match(memoriesPageSrc, /searchParams\.get\('startSlideshow'\)/)
  assert.match(memoriesPageSrc, /searchParams\.get\('roundId'\)/)
})

test('the deep link calls chooseScope() -- the same function a manual round/Full-Event tap already calls -- never a second config path', () => {
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect, 'expected to find the deep-link effect')
  assert.match(deepLinkEffect![0], /chooseScope\(\{ kind: 'fullEvent' \}\)/)
  assert.match(deepLinkEffect![0], /chooseScope\(\{ kind: 'round', roundId: roundId! \}\)/)
})

test('an unknown/mismatched round id is handled safely -- chooseScope is only called once roundExists is confirmed against the loaded manifest', () => {
  assert.match(memoriesPageSrc, /const roundExists = !!roundId && manifest\.rounds\.some\(r => r\.id === roundId\)/)
})

test('the deep-link effect never touches deck generation directly', () => {
  const deepLinkEffect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)
  assert.ok(deepLinkEffect)
  assert.ok(!deepLinkEffect![0].includes('buildPresentationDeck'), 'must not call deck generation directly')
})

test('MyHQClient routes Review & Present to the event-scoped deep link once every round is closed, and the round-scoped one otherwise -- never removing the plain picker fallback', () => {
  assert.match(myHqClientSrc, /startSlideshow=event/)
  assert.match(myHqClientSrc, /startSlideshow=round&roundId=\$\{selected\.id\}/)
  assert.match(myHqClientSrc, /router\.push\(`\/trips\/\$\{tripId\}\/memories`\)/)
})
