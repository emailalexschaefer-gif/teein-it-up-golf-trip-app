import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPresentationChatMessage, parsePresentationChatMessage } from './chatMessage'
import { isPlausibleShareToken } from './tokenShape'

// Source-wiring tests for the organiser -> Chat -> My Golf -> signed-out journey.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const HQ = read('src/components/scoring/MyHQClient.tsx')
const MEM = read('src/app/(app)/trips/[tripId]/memories/page.tsx')
const CHAT = read('src/components/chat/EventMessages.tsx')
const GOLF = read('src/components/scoring/MyRoundClient.tsx')
const MW = read('src/middleware.ts') + read('src/lib/auth/publicRoutes.ts')

test('HQ Stage 5 goes to the event slideshow and is relabelled once all rounds are closed', () => {
  assert.match(HQ, /allRoundsClosed\) \{ router\.push\(`\/trips\/\$\{tripId\}\/memories\?startSlideshow=event`\)/)
  assert.match(HQ, /Create & Share Event Presentation/)
})
test('Event Memories shows an organiser-only Share Event Presentation entry once every round is completed', () => {
  assert.match(MEM, /isOrganiser && manifest\.rounds\.length > 0 && manifest\.rounds\.every\(r => r\.status === 'completed'\)/)
  assert.match(MEM, /Share Event Presentation/)
  assert.match(MEM, /defaultPresentationConfig\(manifest, \{ kind: 'fullEvent' \}\)\); setShowPublishPanel\(true\)/)
})
test('publish panel only renders for the organiser with full-event scope; wizard also offers Publish & Share', () => {
  assert.match(MEM, /showPublishPanel && isOrganiser && presentationConfig && presentationConfig\.scope\.kind === 'fullEvent'/)
  assert.match(MEM, /Publish &amp; Share/)
})
test('Chat renders the card only for announcements that parse as a presentation message', () => {
  assert.match(CHAT, /m\.message_type === 'announcement' && parsePresentationChatMessage\(m\.message\)/)
  const token = 'A'.repeat(43)
  assert.ok(isPlausibleShareToken(token))
  const msg = buildPresentationChatMessage('Lappen Invitational', `https://x.test/s/${token}`)
  assert.ok(parsePresentationChatMessage(msg))
})
test('My Golf renders Watch Event Presentation for every member', () => {
  assert.match(GOLF, /<WatchPresentationLink tripId=\{tripId\} \/>/)
})
test('signed-out viewers: /s/ and /api/s/ are public', () => {
  assert.match(MW, /\/s\//)
  assert.match(MW, /\/api\/s\//)
})
