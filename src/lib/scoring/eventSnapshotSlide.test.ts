import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct), in two stages.
 *
 * Stage 1 (superseded): Event Snapshot rebuilt against the approved
 * reference design using a CSS gradient backdrop + real DOM text
 * (Option B), because the only background asset on hand at the time
 * (event-at-a-glance-bg.jpg) had a mismatched baked heading/subtitle.
 *
 * Stage 2 (current, this file's coverage): the user's review correctly
 * rejected the gradient as not matching the approved photographic
 * composition, and chose Option 2 -- a clean background asset with the
 * dynamic content layered on top as DOM. The user supplied
 * event-at-a-glance-bg-v2.jpg: the approved sunset/water/golf-ball
 * composition with gold divider lines and the logo/tagline already
 * baked in bottom-right, but no event name, heading or stats baked in
 * (confirmed by direct visual inspection before wiring it in). Only
 * the event name, the "EVENT SNAPSHOT" heading, and the four live stat
 * columns are real DOM text; the divider lines and logo are part of
 * the photograph now, not CSS/an extra <img>.
 *
 * No DOM test harness exists for this client component -- static
 * source-level checks.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../components/memories/EventHighlightsPlayer.tsx'), 'utf8')

const glanceBranch = src.match(/if \(slide\.kind === 'eventAtAGlance'\) \{[\s\S]*?\n  \}/)![0]

test('the approved photographic background is used, full-bleed -- not a CSS gradient', () => {
  assert.match(glanceBranch, /src="\/images\/event-at-a-glance-bg-v2\.jpg"/)
  assert.ok(!/background: 'linear-gradient/.test(glanceBranch), 'the old CSS gradient backdrop should be gone')
})

test('the EVENT SNAPSHOT heading is a mandatory, real DOM element -- never baked into the background image', () => {
  assert.match(glanceBranch, />EVENT SNAPSHOT</)
})

test('the event\'s own dynamic name is rendered, not a hardcoded example event', () => {
  assert.match(glanceBranch, /\{slide\.eventName\}/)
  assert.ok(!glanceBranch.includes('Schaefers'), 'no hardcoded example event name should appear')
})

test('no date is rendered on this slide', () => {
  assert.ok(!/dateRange/.test(glanceBranch))
})

test('no separate logo <img> is layered on top -- the logo and tagline are part of the supplied artwork, bottom-right', () => {
  assert.ok(!/<img src="\/images\/event-at-a-glance-logo\.png"/.test(glanceBranch), 'a second logo image should not be layered on the corrected artwork')
})

test('the four live data columns (rounds/holes/side games/champion) are preserved unchanged, including live championCount (never hardcoded)', () => {
  // 12 Oct layout rebuild: the four values feed one statCols array (one
  // shared numeral style) rather than four hand-written JSX blocks.
  assert.match(glanceBranch, /value: slide\.roundCount/)
  assert.match(glanceBranch, /value: slide\.totalHoles/)
  assert.match(glanceBranch, /value: slide\.sideGameCount/)
  assert.match(glanceBranch, /value: slide\.championCount/)
})

test('no column divider lines are drawn in CSS -- they are baked into the supplied artwork, and the stat columns are positioned against the dividers measured from it', () => {
  assert.ok(!/\[34\.2, 50\.2, 66\.6\]\.map/.test(glanceBranch), 'CSS-drawn divider lines should be gone now that the artwork has its own')
  // 12 Oct layout rebuild: columns are absolutely positioned. The three
  // inner column edges are the artwork's measured divider x-positions
  // (35.89 / 50.51 / 64.95%); the Rounds column starts at 19% so its
  // course list stays clear of the golf ball (which ends ~18%).
  assert.match(glanceBranch, /left: 19, width: 16\.89/)
  assert.match(glanceBranch, /left: 35\.89, width: 14\.62/)
  assert.match(glanceBranch, /left: 50\.51, width: 14\.44/)
  assert.match(glanceBranch, /left: 64\.95, width: 16\.65/)
  assert.ok(Math.abs(19 + 16.89 - 35.89) < 0.001 && Math.abs(35.89 + 14.62 - 50.51) < 0.001 && Math.abs(50.51 + 14.44 - 64.95) < 0.001, 'each column should end exactly where the next divider begins')
})
