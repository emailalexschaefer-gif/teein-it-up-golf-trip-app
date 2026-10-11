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
  assert.match(glanceBranch, /\{slide\.roundCount\}/)
  assert.match(glanceBranch, /\{slide\.totalHoles\}/)
  assert.match(glanceBranch, /\{slide\.sideGameCount\}/)
  assert.match(glanceBranch, /\{slide\.championCount\}/)
})

test('no column divider lines are drawn in CSS -- they are baked into the supplied artwork, and the stat columns are measured to align with them', () => {
  assert.ok(!/\[34\.2, 50\.2, 66\.6\]\.map/.test(glanceBranch), 'CSS-drawn divider lines should be gone now that the artwork has its own')
  // Column widths sum to 100% and match the positions measured
  // directly from this specific image's own baked divider lines.
  assert.match(glanceBranch, /width: '35\.89%'/)
  assert.match(glanceBranch, /width: '14\.62%'/)
  assert.match(glanceBranch, /width: '14\.44%'/)
  assert.match(glanceBranch, /width: '35\.05%'/)
  const total = 35.89 + 14.62 + 14.44 + 35.05
  assert.ok(Math.abs(total - 100) < 0.01, `column widths should sum to 100%, got ${total}`)
})
