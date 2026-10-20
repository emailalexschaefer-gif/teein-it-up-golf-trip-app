import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeResumeIndex } from './resumeHole'
import { pickCurrentRound } from './currentRound'
import { isIdenticalRecordedResend } from './recordedResend'
import { holeOptionLabel } from '../sideGames/holeOptionLabel'
import { deriveSyncStatus } from '../db/syncStatus'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const H18 = Array.from({ length: 18 }, (_, i) => i + 1)
const set = (...n: number[]) => (h: number) => n.includes(h)
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ── Issue 4: resume at the last scored hole ─────────────────────────────
test('ISSUE 4: nothing scored -> caller keeps its default (Hole 1 / start hole / deep link); we never choose', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(), partnerRequired: false, partnerDone: set() })
  assert.equal(r.anyScored, false)
})

test('ISSUE 4: holes 1-6 complete -> reopens on Hole 7 (next to score); Previous Hole reviews 6', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(...range(1, 6)), partnerRequired: false, partnerDone: set() })
  assert.deepEqual([r.anyScored, H18[r.index]], [true, 7])
})

test('ISSUE 4: advanceAfterComplete:false reopens ON the last scored hole (the one-line switch for the other preference)', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(...range(1, 6)), partnerRequired: false, partnerDone: set(), advanceAfterComplete: false })
  assert.equal(H18[r.index], 6)
})

test('ISSUE 4: own score in but the partner\'s missing -> stays on that hole so it can be finished', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(...range(1, 6)), partnerRequired: true, partnerDone: set(...range(1, 5)) })
  assert.equal(H18[r.index], 6)
})

test('ISSUE 4: partner score entered but own missing counts as scored and stays', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(1, 2, 3), partnerRequired: true, partnerDone: set(1, 2, 3, 4) })
  assert.equal(H18[r.index], 4)
})

test('ISSUE 4: a skipped earlier hole does not drag the player back (last scored wins) but is still reachable', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(1, 2, 4, 5, 6), partnerRequired: false, partnerDone: set() })
  assert.equal(H18[r.index], 7)
  const end = computeResumeIndex({ holeNumbers: H18, ownDone: set(...H18.filter(h => h !== 3)), partnerRequired: false, partnerDone: set() })
  assert.equal(H18[end.index], 3, 'only gap left is offered')
})

test('ISSUE 4: every hole done -> last hole in play order, allDone', () => {
  const r = computeResumeIndex({ holeNumbers: H18, ownDone: set(...H18), partnerRequired: false, partnerDone: set() })
  assert.deepEqual([H18[r.index], r.allDone], [18, true])
})

test('ISSUE 4: shotgun start hole 6 -> follows play order 6..18,1..5', () => {
  const start = H18.indexOf(6)
  const mid = computeResumeIndex({ holeNumbers: H18, startIndex: start, ownDone: set(6, 7, 8), partnerRequired: false, partnerDone: set() })
  assert.equal(H18[mid.index], 9)
  const wrapped = computeResumeIndex({ holeNumbers: H18, startIndex: start, ownDone: set(...range(6, 18), 1, 2), partnerRequired: false, partnerDone: set() })
  assert.equal(H18[wrapped.index], 3)
})

test('ISSUE 4: 9-hole back nine (holes 10-18) and an 18-hole round starting on the 10th (order 10..18,1..9) are respected', () => {
  const back9 = range(10, 18)
  assert.equal(back9[computeResumeIndex({ holeNumbers: back9, ownDone: set(10, 11, 12), partnerRequired: false, partnerDone: set() }).index], 13)
  const tenth = [...range(10, 18), ...range(1, 9)]
  assert.equal(tenth[computeResumeIndex({ holeNumbers: tenth, ownDone: set(...range(10, 18), 1), partnerRequired: false, partnerDone: set() }).index], 2)
})

test('ISSUE 4: empty hole list is safe', () => {
  assert.equal(computeResumeIndex({ holeNumbers: [], ownDone: set(), partnerRequired: false, partnerDone: set() }).anyScored, false)
})

// ── Issue 4: which round does Scorecard open ───────────────────────────────
test('ISSUE 4: only an ACTIVE round is current; never a completed older one', () => {
  assert.equal(pickCurrentRound([{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'upcoming' }]), null)
  assert.equal(pickCurrentRound([{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'active' }])!.id, 'r2')
})

test('ISSUE 4: if two rounds are somehow active the NEWEST wins, regardless of list order', () => {
  const a = { id: 'r1', status: 'active', play_date: '2026-10-17', tee_time: '08:00' }
  const b = { id: 'r2', status: 'active', play_date: '2026-10-18', tee_time: '08:00' }
  assert.equal(pickCurrentRound([a, b])!.id, 'r2')
  assert.equal(pickCurrentRound([b, a])!.id, 'r2')
  const c = { id: 'r3', status: 'active', play_date: '2026-10-18', tee_time: '13:00' }
  assert.equal(pickCurrentRound([b, c])!.id, 'r3')
})

test('ISSUE 4 wiring: the Scorecard nav link resolves the round at tap time, not from the layout\'s remembered id', () => {
  const nav = src('src/components/layout/TripBottomNav.tsx')
  assert.match(nav, /const scorecardHref = `\$\{base\}\/scorecard`/)
  assert.doesNotMatch(nav, /scorecardHref = activeRoundId/)
  assert.match(nav, /noPrefetch: true/)
  assert.equal((nav.match(/prefetch=\{item\.noPrefetch \? false : undefined\}/g) ?? []).length, 2, 'mobile and desktop links')
  const page = src('src/app/(app)/trips/[tripId]/scorecard/page.tsx')
  assert.match(page, /export const dynamic = 'force-dynamic'/)
  assert.match(page, /\.eq\('status', 'active'\)/)
  assert.match(page, /pickCurrentRound/)
  assert.match(page, /redirect\(current \? `\/trips\/\$\{tripId\}\/rounds\/\$\{current\.id\}` : `\/trips\/\$\{tripId\}`\)/)
  assert.match(page, /redirect\('\/login'\)/)
})

test('ISSUE 4 wiring: the score screen drops its cached scores on leave, uses the resume rule, respects deep links and the shotgun seed', () => {
  const s = src('src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx')
  assert.match(s, /gcTime: 0/)
  assert.match(s, /computeResumeIndex\(\{/)
  assert.match(s, /const deepLinked = Number\(searchParams\?\.get\('hole'\)\) > 0/)
  assert.match(s, /if \(r\.anyScored && !deepLinked\)/)
  assert.match(s, /resolvedStartHole !== null && !resumePositionedRef\.current/)
  // pending offline entries are merged BEFORE the resume position is computed
  assert.ok(s.indexOf('getQueuedEntriesForScorecards(scorecardIds)') < s.indexOf('computeResumeIndex({'))
  // the old "first gap" scan is gone
  assert.doesNotMatch(s, /let target = holes\.length - 1/)
})

// ── Issue 1: score review errors ───────────────────────────────────────────
const req = { scorecard_id: 'sc1', hole_id: 'h1', capture_role: 'self' as const, gross_score: 4, is_no_return: false }
const row = { ...req, entered_by: 'u1' }

test('ISSUE 1: an IDENTICAL re-send of a score the server already holds is recognised', () => {
  assert.equal(isIdenticalRecordedResend(row, req, 'u1'), true)
  assert.equal(isIdenticalRecordedResend({ ...row, gross_score: null, is_no_return: true }, { ...req, gross_score: null, is_no_return: true }, 'u1'), true, 'pick-up')
})

test('ISSUE 1: anything that is not identical is NOT a re-send (closed-card protection stands)', () => {
  assert.equal(isIdenticalRecordedResend(null, req, 'u1'), false, 'unknown client_id: a genuinely new score')
  assert.equal(isIdenticalRecordedResend({ ...row, gross_score: 5 }, req, 'u1'), false, 'different value')
  assert.equal(isIdenticalRecordedResend({ ...row, gross_score: null, is_no_return: true }, req, 'u1'), false)
  assert.equal(isIdenticalRecordedResend({ ...row, scorecard_id: 'other' }, req, 'u1'), false)
  assert.equal(isIdenticalRecordedResend({ ...row, hole_id: 'h2' }, req, 'u1'), false)
  assert.equal(isIdenticalRecordedResend({ ...row, capture_role: 'marker' }, req, 'u1'), false)
  assert.equal(isIdenticalRecordedResend(row, req, 'someone-else'), false, 'another user\'s row')
  assert.equal(isIdenticalRecordedResend({ ...row, entered_by: null }, req, 'u1'), false)
})

test('ISSUE 1 wiring: the closed-card and closed-round gates acknowledge ONLY an identical re-send, as a read-only duplicate; otherwise the same 422 as before', () => {
  const r = src('src/app/api/scores/route.ts')
  const card = r.slice(r.indexOf("if (scorecard.status !== 'active')"), r.indexOf("if (scorecard.status !== 'active')") + 520)
  assert.match(card, /findAlreadyRecordedResend/)
  assert.match(card, /duplicate: true/)
  assert.match(card, /'Scorecard not active' \}, \{ status: 422 \}/)
  const rd = r.slice(r.indexOf("if (!round || round.status !== 'active')"), r.indexOf("if (!round || round.status !== 'active')") + 520)
  assert.match(rd, /findAlreadyRecordedResend/)
  assert.match(rd, /'Round is not active' \}, \{ status: 422 \}/)
  assert.match(r, /'Scorecard not found' \}, \{ status: 422 \}/, 'a missing scorecard is still refused')
  // the helper only reads
  const helper = r.slice(r.indexOf('async function findAlreadyRecordedResend'), r.indexOf('export async function POST'))
  assert.doesNotMatch(helper, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.match(helper, /isIdenticalRecordedResend/)
  // active-card path untouched: the write path still goes through decideScoreWrite
  assert.match(r, /decideScoreWrite\(existingForRole\?\.data \?\? null/)
})

test('ISSUE 1 wiring: the banner reports only THIS round\'s refusals as the red status; older ones get a separate calm notice; nothing is auto-cleared', () => {
  const b = src('src/components/scoring/SyncStatusBanner.tsx')
  assert.match(b, /roundScorecardIds\.includes\(e\.scorecardId\)/)
  assert.match(b, /rejectedCount: rejectedHere/)
  assert.match(b, /older score from another round was/)
  assert.match(b, /older scores from other rounds were/)
  assert.match(b, /showOther/)
  assert.doesNotMatch(b, /clear\(\)|\.delete\(|localStorage|indexedDB/)
  // when entry details could not be read, never hide a refusal
  assert.match(b, /detailKnown \? hereEntries\.length : rejectedCount/)
  // both lists use the same renderer (same Try again / organiser-only Discard-with-confirm)
  assert.match(b, /hereEntries\.map\(renderEntry\)/)
  assert.match(b, /otherEntries\.map\(renderEntry\)/)
})

test('ISSUE 1: status wording is driven by this round\'s count only', () => {
  const base = { online: true, syncState: 'idle' as const, pendingCount: 0, lastFailure: null }
  assert.equal(deriveSyncStatus({ ...base, rejectedCount: 0 }).kind, 'idle')
  assert.equal(deriveSyncStatus({ ...base, rejectedCount: 4 }).kind, 'rejected')
})

// ── Issue 7: hole pars in the Side Game selector ───────────────────────────
test('ISSUE 7: label shows the hole\'s par from the round\'s own course data', () => {
  const snap = [{ hole_number: 3, par: 3 }, { hole_number: 6, par: 3 }, { hole_number: 9, par: 5 }]
  assert.equal(holeOptionLabel(3, snap), 'Hole 3 — Par 3')
  assert.equal(holeOptionLabel(6, snap), 'Hole 6 — Par 3')
  assert.equal(holeOptionLabel(9, snap), 'Hole 9 — Par 5')
})

test('ISSUE 7: no course data (manual round) or an unknown hole -> plain "Hole N"; a par is never invented', () => {
  assert.equal(holeOptionLabel(3, null), 'Hole 3')
  assert.equal(holeOptionLabel(3, undefined), 'Hole 3')
  assert.equal(holeOptionLabel(3, []), 'Hole 3')
  assert.equal(holeOptionLabel(4, [{ hole_number: 3, par: 3 }]), 'Hole 4')
  assert.equal(holeOptionLabel(3, [{ hole_number: 3, par: 0 }]), 'Hole 3')
})

test('ISSUE 7 wiring: the selector uses the label with the round\'s frozen hole data; its value (hole number) is unchanged', () => {
  const s = src('src/components/trips/wizard/StepRounds.tsx')
  assert.match(s, /<option key=\{h\} value=\{h\}>\{holeOptionLabel\(h, round\.library_holes_snapshot\)\}<\/option>/)
  assert.match(s, /computeHolePlayOrder\(round\.holes, round\.starting_hole_number \?\? 1\)/)
})
