import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct), Task #59 -- closing slide rework, in two stages.
 *
 * Stage 1 (superseded): Option B -- the user's initial choice of real,
 * styleable DOM text layered over a blurred backdrop, adopted because
 * no clean background asset existed yet.
 *
 * Stage 2 (current, this file's coverage): the user's review correctly
 * pointed out the blur treatment traded away the crisp photographic
 * quality they wanted. Investigation found none of this slide's text
 * is actually event-specific ("What a Great Event!", the My Golf line,
 * "See you at the next one!", and the tagline are all fixed copy) --
 * so DOM overlay was solving a non-problem. The user supplied a
 * corrected, fully-baked static asset (event-highlights-closing-v2.jpg,
 * with "My Golf" already gold/bold/underlined in the artwork itself),
 * and this is now rendered full-bleed with no blur and no DOM overlay.
 * Static source-level check -- no DOM harness for this client component.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../components/memories/EventHighlightsPlayer.tsx'), 'utf8')

// The closing branch is the function's final `return` -- isolate from
// its own distinctive comment marker through the end of NonPhotoSlide.
// (A bare "// closing" also appears inside an unrelated, earlier
// comment elsewhere in this file, so anchor on the more specific line.)
const closingBranch = src.slice(src.indexOf('// closing\n  // Phase E (11 Oct) verification pass'), src.indexOf('/**\n * MomentsSourceLabel'))
assert.ok(closingBranch.length > 50, 'expected to find the closing-slide branch')

test('the closing slide renders the corrected static artwork, full-bleed', () => {
  assert.match(closingBranch, /src="\/images\/event-highlights-closing-v2\.jpg"/)
  assert.match(closingBranch, /objectFit: 'cover'/)
})

test('no blur/gradient backdrop treatment remains -- the artwork is shown crisp, as supplied', () => {
  assert.ok(!/filter: 'blur/.test(closingBranch), 'the old blurred-backdrop treatment should be gone')
  assert.ok(!/linear-gradient\(rgba\(5,12,9/.test(closingBranch), 'the old darkening overlay should be gone')
})

test('no DOM text layer is rendered over the image -- all copy ("What a Great Event!", the My Golf line, tagline) is now baked into the artwork itself', () => {
  assert.ok(!/>\s*What a Great Event!\s*</.test(closingBranch), 'should not render this as separate DOM text any more')
  assert.ok(!/<span style=\{\{[^}]*\}\}>My Golf<\/span>/.test(closingBranch), 'My Golf should no longer need its own styled DOM span -- it is baked into the image')
})

test('no separate logo <img> is layered on top -- the logo is part of the supplied artwork', () => {
  assert.ok(!/<img src="\/images\/event-at-a-glance-logo\.png"/.test(closingBranch), 'a second logo image should not be layered on the corrected artwork')
})

test('the image has real descriptive alt text (not aria-hidden), since it now carries all of the slide\'s actual content', () => {
  assert.match(closingBranch, /alt="What a great event!/)
  assert.ok(!/aria-hidden/.test(closingBranch), 'the image is the real content now, not a decorative backdrop')
})
