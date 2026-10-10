import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * My HQ V2 (10 Oct), Phase C — RoundWorkflowTracker is a pure
 * presentational client component (hooks-free, but still JSX/'use
 * client') with no DOM/React test harness set up in this project (see
 * makersBreakersStage4Fix.test.ts for the established convention this
 * follows). These are static source-level checks confirming the
 * component stays wired to the approved contract: it never recomputes
 * lifecycle state itself, it surfaces every approved refinement
 * (Stage 3 waiting text, Stage 4 revisit affordance, Stage 5 muted
 * "accessible but not primary" state), and it never mutates anything
 * directly.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'RoundWorkflowTracker.tsx'), 'utf8')

test('imports stage status from the derivation module rather than recomputing lifecycle state itself', () => {
  assert.match(src, /import type \{ WorkflowStage, WorkflowStageId \} from '@\/lib\/scoring\/roundWorkflow'/)
  assert.ok(!/round\.status/.test(src), 'must never read round.status directly -- only the already-derived WorkflowStage fields')
})

test('every action is delegated to the caller via onAction -- no fetch/mutation call sites of its own', () => {
  assert.ok(!src.includes('fetch('), 'tracker must not perform its own network calls')
  assert.match(src, /onAction: \(stageId: WorkflowStageId\) => void/)
})

test('a distinct "waiting" visual state exists for Stage 3 staying visible during live play, separate from "upcoming"', () => {
  assert.match(src, /'waiting'/)
  assert.match(src, /badge: 'Waiting'/)
})

test('Stage 4 exposes a "Review again" affordance once complete -- never a locked terminal row', () => {
  assert.match(src, /Review again/)
  assert.match(src, /stage\.id === 'makersBreakers'/)
})

test('an "accessible but not primary" muted state exists so Stage 5 never visually competes with Stage 4 as a second primary action', () => {
  assert.match(src, /'accessible'/)
  assert.match(src, /badge: 'Available'/)
})

test('exactly one state renders the prominent primary CTA styling', () => {
  const primaryButtonBlocks = src.match(/state === 'primary' &&/g) ?? []
  assert.equal(primaryButtonBlocks.length, 1)
})

test('colour is never the only signal -- every visual state also renders a distinct text badge', () => {
  const badges = [...src.matchAll(/badge: '([^']+)'/g)].map(m => m[1])
  assert.deepEqual(new Set(badges).size, badges.length, 'badges should be distinct per state')
  assert.ok(badges.length >= 6)
})
