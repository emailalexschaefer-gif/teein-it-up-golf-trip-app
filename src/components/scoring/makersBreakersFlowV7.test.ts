import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/components/scoring/MakersBreakers.tsx', 'utf8')
const shell = readFileSync('src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx', 'utf8')

test('Select -> Save: the curating screen saves (one write) and lands on the saved view', () => {
  assert.match(src, /async function saveSelection\(\)[\s\S]*?setStage\('published'\)/)
  assert.match(src, /onClick=\{\(\) => void saveSelection\(\)\}/)
  assert.match(src, /Save \$\{selected\.size\} Highlight/)
})
test('Review & Present is offered from the saved view and presents the SAVED highlights', () => {
  assert.match(src, /data-testid="mb-review-present"/)
  assert.match(src, /const saved = publishedHighlights \?\? \[\]/)
})
test('no second publish step after presenting', () => {
  assert.doesNotMatch(src, /Finish & Publish/)
  assert.equal((src.match(/(?:await|return) doPublish\(/g) ?? []).length, 2) // publish() + skipReview() only
})
test('Skip and Edit Selection remain', () => {
  assert.match(src, /skipReview/)
  assert.match(src, /Edit Selection/)
})
test('shell: late-mismatch banner is wired, non-blocking, and uses the shared indicator', () => {
  assert.match(shell, /findLateMismatches/)
  assert.match(shell, /data-testid="late-mismatch-banner"/)
  assert.match(shell, /statusIndicator\(status\)\.label/)
  assert.doesNotMatch(shell, /\{partnerNote && \(\s*<div[^>]*position: 'fixed'/)
})
