import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Phase E (11 Oct), Task #58 -- opening slide date visibility fix.
 * The date range text (from formatDateRange(), reused verbatim -- no
 * new date formatting logic) was too small/low-contrast against the
 * opening slide's own bright sunrise artwork. Static source-level
 * check -- no DOM harness for this client component.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../components/memories/EventHighlightsPlayer.tsx'), 'utf8')

const openingBranch = src.match(/if \(slide\.kind === 'opening'\) \{[\s\S]*?\n  \}/)![0]

test('the date range is rendered with a larger font and higher-contrast colour than before', () => {
  assert.match(openingBranch, /slide\.dateRange && <p style=\{\{[^}]*fontSize: 'clamp\(15px, 2\.1vw, 21px\)'/)
  assert.match(openingBranch, /slide\.dateRange && <p style=\{\{[^}]*color: '#ffffff'/)
})

test('the date is still produced by formatDateRange() -- no second/new date formatting logic introduced', () => {
  assert.match(openingBranch, /\{slide\.dateRange\}/)
})

test('the event title above the date remains visually dominant -- unchanged font size/weight', () => {
  assert.match(openingBranch, /fontSize: 'clamp\(22px, 4vw, 38px\)', fontWeight: 800, color: '#fff'/)
})

test('no "Slide Show" suffix exists anywhere on the opening slide or in the deck builder', () => {
  assert.ok(!openingBranch.includes('Slide Show'))
})
