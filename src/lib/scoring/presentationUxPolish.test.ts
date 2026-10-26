import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  snapshotTitleCqw, splitCourseName, pillarboxCqw, momentsLabelPlacement, momentsLabelHeading,
  SIDE_CARD_MIN_PILLARBOX_CQW,
} from '../trips/presentationLayout'

/**
 * Presentation UX polish (12 Oct 2026), from real Samsung testing:
 *  1. Create Presentation must land on the Event Memories home, not open
 *     the "Which Memories should we include?" popup immediately.
 *  2. Event Snapshot layout: one 16:9 composition sized to the canvas.
 *  3. Branded "Relive it in My Golf -> Moments" label on Moment/Blooper
 *     slides.
 * Pure rules are tested with real inputs; the client components have no
 * DOM harness in this project, so wiring is checked statically (the same
 * convention as the other *.test.ts files in this folder).
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const memoriesPageSrc = read('../../app/(app)/trips/[tripId]/memories/page.tsx')
const playerSrc = read('../../components/memories/EventHighlightsPlayer.tsx')
const deckSrc = read('../trips/slideshowDeck.ts')

// ---------------------------------------------------------------- 1. Entry flow

test('deep link no longer opens the memory-selection popup on arrival', () => {
  const effect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)![0]
  assert.ok(!/chooseScope\(/.test(effect))
  assert.ok(!/setSlideshowStep\(/.test(effect))
})

test('deep link pre-selects scope and highlights the matching round chip (event -> All, round -> that round)', () => {
  const effect = memoriesPageSrc.match(/useEffect\(\(\) => \{\s*if \(deepLinkHandled[\s\S]*?\n {2}\}, \[manifest, deepLinkHandled\]\)/)![0]
  assert.match(effect, /setPendingScope\(\{ kind: 'fullEvent' \}\)\s*\n\s*setFilterRoundId\('all'\)/)
  assert.match(effect, /setPendingScope\(\{ kind: 'round', roundId: roundId! \}\)\s*\n\s*setFilterRoundId\(roundId!\)/)
})

test('Create Slideshow opens the popup via the pending scope, otherwise falls back to the normal scope picker', () => {
  assert.match(memoriesPageSrc, /onClick=\{\(\) => \{ if \(pendingScope\) chooseScope\(pendingScope\); else setSlideshowStep\('scope'\) \}\}/)
})

test('tapping any round chip clears the pending scope so Create Slideshow never launches a stale scope', () => {
  assert.match(memoriesPageSrc, /onClick=\{\(\) => \{ setPendingScope\(null\); setFilterRoundId\('all'\) \}\}/)
  assert.match(memoriesPageSrc, /onClick=\{\(\) => \{ setPendingScope\(null\); setFilterRoundId\(r\.id\) \}\}/)
})

test('the existing popup flow and URL cleanup are preserved (guarded once, params stripped via router.replace)', () => {
  assert.match(memoriesPageSrc, /slideshowStep === 'memories' && presentationConfig && manifest/)
  assert.match(memoriesPageSrc, /Which Memories should we include\?/)
  assert.match(memoriesPageSrc, /router\.replace\(pathname, \{ scroll: false \}\)/)
  assert.match(memoriesPageSrc, /if \(deepLinkHandled \|\| !manifest\) return/)
})

test('an organiser with zero photos can still start a slideshow from the My HQ deep link (Create Slideshow is otherwise hidden at zero photos)', () => {
  assert.match(memoriesPageSrc, /isOrganiser && pendingScope && \(\s*\n\s*<button\s*\n\s*onClick=\{\(\) => chooseScope\(pendingScope\)\}/)
})

// ---------------------------------------------------------------- 2. Event Snapshot

test('snapshotTitleCqw: short names use full reference size', () => {
  assert.equal(snapshotTitleCqw('Schaefers Invitational'), 5.2)
  assert.equal(snapshotTitleCqw('Golf Day'), 5.2)
})

test('snapshotTitleCqw: long names shrink proportionally and stay within one canvas line', () => {
  const longName = 'Schaefers Invitational - Slide Show' // 35 chars
  const size = snapshotTitleCqw(longName)
  assert.ok(size < 5.2 && size > 2.6, `expected a proportional shrink, got ${size}`)
  // approx width = chars * 0.55em * size must fit in the 88cqw title block
  assert.ok(longName.length * 0.55 * size <= 88, 'long title should fit on one line')
})

test('snapshotTitleCqw: never below the floor, and empty names do not break it', () => {
  assert.equal(snapshotTitleCqw('x'.repeat(200)), 2.6)
  assert.equal(snapshotTitleCqw(''), 5.2)
})

test('splitCourseName splits "Club — Course" onto two lines, with em/en dashes and spaced hyphens', () => {
  assert.deepEqual(splitCourseName('Sandhurst Club — Champions Course'), { club: 'Sandhurst Club', course: 'Champions Course' })
  assert.deepEqual(splitCourseName('Heritage Golf & Country Club – St. John’s Course'), { club: 'Heritage Golf & Country Club', course: 'St. John’s Course' })
  assert.deepEqual(splitCourseName('Pine Valley - North'), { club: 'Pine Valley', course: 'North' })
})

test('splitCourseName leaves names without a separator whole (including hyphenated words)', () => {
  assert.deepEqual(splitCourseName('Kingston Heath'), { club: 'Kingston Heath', course: null })
  assert.deepEqual(splitCourseName('Port-Stephens Links'), { club: 'Port-Stephens Links', course: null })
})

const snapshotBranch = playerSrc.match(/if \(slide\.kind === 'eventAtAGlance'\) \{[\s\S]*?\n {2}\}/)![0]

test('Event Snapshot sizes in canvas units (cqw), not viewport units -- the cause of the real-device overflow', () => {
  assert.ok(!/\bvw\b|\d\s*vw|vh/.test(snapshotBranch.replace(/\/\/.*$/gm, '')), 'no vw/vh sizing should remain in the snapshot layout')
  assert.match(snapshotBranch, /cqw/)
  assert.match(playerSrc, /containerType: 'inline-size'/)
})

test('Event Snapshot renders the dynamic event name via the scaling helper, with EVENT SNAPSHOT directly beneath, and no date', () => {
  assert.match(snapshotBranch, /snapshotTitleCqw\(slide\.eventName\)/)
  assert.match(snapshotBranch, /\{slide\.eventName\}/)
  const nameIdx = snapshotBranch.indexOf('{slide.eventName}')
  const headingIdx = snapshotBranch.indexOf('>EVENT SNAPSHOT<')
  assert.ok(nameIdx > -1 && headingIdx > nameIdx, 'EVENT SNAPSHOT must come after (below) the title')
  assert.ok(!/dateRange|playDate/.test(snapshotBranch))
})

test('Event Snapshot keeps all four live statistics equally prominent, with champion tie/pending states driven by live championCount', () => {
  for (const f of ['roundCount', 'totalHoles', 'sideGameCount', 'championCount']) assert.match(snapshotBranch, new RegExp(`slide\\.${f}`))
  // all four numerals share one size (a single map over statCols)
  assert.equal((snapshotBranch.match(/fontSize: '4\.9cqw'/g) ?? []).length, 1)
  assert.match(snapshotBranch, /statCols\.map/)
})

test('course names are left-aligned from just right of the golf ball and use the two-line club/course split', () => {
  assert.match(snapshotBranch, /splitCourseName\(name\)/)
  assert.match(snapshotBranch, /left: 19, width: 16\.89/)
})

test('no hardcoded demo event data in the Event Snapshot renderer', () => {
  assert.ok(!/Schaefers|Sandhurst|Heritage/.test(snapshotBranch))
})

// ---------------------------------------------------------------- 3. Moments label

test('pillarboxCqw: 3:4 portrait leaves wide side bars; 16:9 leaves none; invalid aspect is safe', () => {
  assert.ok(Math.abs(pillarboxCqw(0.75) - 28.90625) < 1e-9)
  assert.equal(pillarboxCqw(16 / 9), 0)
  assert.equal(pillarboxCqw(2.4), 0)
  assert.equal(pillarboxCqw(0), 0)
  assert.equal(pillarboxCqw(NaN), 0)
})

test('momentsLabelPlacement: portrait and square media use the side card; 4:3 and landscape use the corner pill', () => {
  assert.equal(momentsLabelPlacement(0.5625).mode, 'side') // 9:16 phone video
  assert.equal(momentsLabelPlacement(0.75).mode, 'side')   // 3:4 portrait photo (e.g. a presentation award)
  assert.equal(momentsLabelPlacement(1).mode, 'side')      // square
  assert.equal(momentsLabelPlacement(4 / 3).mode, 'corner')
  assert.equal(momentsLabelPlacement(16 / 9).mode, 'corner')
  assert.equal(momentsLabelPlacement(3).mode, 'corner')
})

test('side card is only chosen when the pillarbox is genuinely wide enough to read on a phone', () => {
  const p = momentsLabelPlacement(0.75)
  assert.ok(p.mode === 'side' && p.sideSpaceCqw >= SIDE_CARD_MIN_PILLARBOX_CQW)
  assert.ok(pillarboxCqw(4 / 3) < SIDE_CARD_MIN_PILLARBOX_CQW)
})

test('momentsLabelHeading: BLOOPERS only for an organiser-flagged Blooper; everything else is EVENT MOMENTS', () => {
  assert.equal(momentsLabelHeading(true), 'BLOOPERS')
  assert.equal(momentsLabelHeading(false), 'EVENT MOMENTS')
  assert.equal(momentsLabelHeading(undefined), 'EVENT MOMENTS')
})

test('the label is rendered only for photo Moments and Blooper slides -- never group photo, winners, champion or any other slide', () => {
  const mount = playerSrc.match(/\{(?:slideReady && )?\(isPhoto\(current\) \|\| isBlooper\(current\)\) && mediaSize[\s\S]*?\/>\s*\n\s*\)\}/)
  assert.ok(mount, 'expected a single, kind-gated mount')
  assert.equal((playerSrc.match(/<MomentsSourceLabel/g) ?? []).length, 1, 'mounted exactly once, so it can never duplicate')
  assert.match(mount![0], /mediaSize\.key === current\.momentId/)
  assert.match(mount![0], /momentsLabelHeading\(/)
})

test('the label uses the approved wording, never intercepts taps, and is hidden from assistive tech (the photo keeps its own alt text)', () => {
  const comp = playerSrc.match(/function MomentsSourceLabel[\s\S]*?\n\}\n/)![0]
  assert.match(comp, /Relive it in/)
  assert.match(comp, /My Golf &rarr; Moments/)
  assert.equal((comp.match(/pointerEvents: 'none'/g) ?? []).length, 2, 'both placements ignore pointer events')
  assert.match(comp, /TEEIN&rsquo; IT UP/)
})

test('the label sits below the controls layer so playback controls, mute and close always win', () => {
  const labelIdx = playerSrc.indexOf('<MomentsSourceLabel')
  const controlsIdx = playerSrc.indexOf('Controls -- fade during playback')
  assert.ok(labelIdx > -1 && controlsIdx > labelIdx)
})

test('media size is reported from the real image/video, and the label waits for it (no guessing)', () => {
  assert.match(playerSrc, /onLoad=\{visible \? \(e\) => reportMediaSize\(slide\.momentId, e\.currentTarget\.naturalWidth, e\.currentTarget\.naturalHeight\)/)
  assert.match(playerSrc, /onLoadedMetadata=\{\(e\) => onMediaSize\?\.\(slide\.momentId, e\.currentTarget\.videoWidth, e\.currentTarget\.videoHeight\)\}/)
  assert.match(playerSrc, /mediaSize && mediaSize\.key === current\.momentId/)
})

test('photo/video rendering itself is unchanged: still object-fit contain (no crop/stretch), video still muted-controlled with the same failure handling', () => {
  assert.match(playerSrc, /muted=\{videoMuted\}/)
  assert.match(playerSrc, /onError=\{onVideoFailed\}/)
  assert.ok(!/objectFit: 'cover'[^}]*onLoad=\{visible/.test(playerSrc))
})

test('deck: Blooper slides carry an optional, display-only isBlooper flag sourced from the memory record', () => {
  assert.match(deckSrc, /caption: string \| null; isBlooper\?: boolean \}/)
  assert.match(deckSrc, /caption: b\.caption, isBlooper: b\.isBlooper,/)
})
