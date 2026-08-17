import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTarget, computePhase, daysBetweenCalendarDates } from './countdown'

function iso(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

test('computeTarget — prefers earliest group tee time over round tee_time', () => {
  const round = { play_date: '2026-10-24', tee_time: '09:00' }
  const target = computeTarget(round, '08:00')
  assert.equal(target?.date.getHours(), 8)
  assert.equal(target?.hasTime, true)
})

test('computeTarget — falls back to round tee_time when no group time exists', () => {
  const round = { play_date: '2026-10-24', tee_time: '09:00' }
  const target = computeTarget(round, null)
  assert.equal(target?.date.getHours(), 9)
})

test('computeTarget — date-only when neither tee time exists, never assumes a real start time', () => {
  const round = { play_date: '2026-10-24', tee_time: null }
  const target = computeTarget(round, null)
  assert.equal(target?.hasTime, false)
  assert.equal(target?.date.getHours(), 0)
})

test('15 days before — simple day-count label', () => {
  const now = new Date()
  const target = new Date(now)
  target.setDate(target.getDate() + 15)
  const phase = computePhase({ date: target, hasTime: true }, now)
  assert.equal(phase.kind, 'days')
  if (phase.kind === 'days') assert.equal(phase.label, '15 DAYS TO GO')
})

test('exactly around the 72-hour threshold — 73 hours shows days, 71 hours shows clock', () => {
  const now = new Date('2026-08-10T12:00:00')
  const just73h = new Date(now.getTime() + 73 * 3600000)
  const just71h = new Date(now.getTime() + 71 * 3600000)
  const p1 = computePhase({ date: just73h, hasTime: true }, now)
  const p2 = computePhase({ date: just71h, hasTime: true }, now)
  assert.equal(p1.kind, 'days')
  assert.equal(p2.kind, 'clock')
})

test('2 days + several hours before — clock phase shows days/hours/minutes, no seconds', () => {
  const now = new Date('2026-08-10T12:00:00')
  const target = new Date(now.getTime() + (2 * 24 + 5) * 3600000 + 20 * 60000)
  const phase = computePhase({ date: target, hasTime: true }, now)
  assert.equal(phase.kind, 'clock')
  if (phase.kind === 'clock') {
    assert.equal(phase.days, 2)
    assert.equal(phase.hours, 5)
    assert.equal(phase.seconds, null) // no seconds outside the final hour
  }
})

test('23 hours before — clock phase, no days component shown, no seconds', () => {
  const now = new Date('2026-08-10T12:00:00')
  const target = new Date(now.getTime() + 23 * 3600000)
  const phase = computePhase({ date: target, hasTime: true }, now)
  assert.equal(phase.kind, 'clock')
  if (phase.kind === 'clock') {
    assert.equal(phase.days, 0)
    assert.equal(phase.hours, 23)
    assert.equal(phase.seconds, null)
  }
})

test('45 minutes before — final-hour phase includes seconds', () => {
  const now = new Date('2026-08-10T12:00:00')
  const target = new Date(now.getTime() + 45 * 60000)
  const phase = computePhase({ date: target, hasTime: true }, now)
  assert.equal(phase.kind, 'clock')
  if (phase.kind === 'clock') {
    assert.equal(phase.hours, 0)
    assert.equal(phase.minutes, 45)
    assert.notEqual(phase.seconds, null)
  }
})

test('start time reached but organiser has not started the round — tee-time transitional state', () => {
  const now = new Date('2026-08-10T09:01:00')
  const target = new Date('2026-08-10T09:00:00')
  const phase = computePhase({ date: target, hasTime: true }, now)
  assert.equal(phase.kind, 'tee-time')
})

test('date-only round with no reliable tee time — day labels only, even on the day itself', () => {
  const now = new Date()
  const todayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const phase = computePhase({ date: todayTarget, hasTime: false }, now)
  assert.equal(phase.kind, 'days')
  if (phase.kind === 'days') assert.equal(phase.label, 'TODAY')
})

test('date-only round — TOMORROW label exactly one calendar day out', () => {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const phase = computePhase({ date: tomorrow, hasTime: false }, now)
  assert.equal(phase.kind, 'days')
  if (phase.kind === 'days') assert.equal(phase.label, 'TOMORROW')
})

test('date-only round — past date with no time produces no misleading display', () => {
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const phase = computePhase({ date: yesterday, hasTime: false }, now)
  assert.equal(phase.kind, 'none')
})

test('organiser changes Round 1 tee time — countdown is purely derived, recomputing with the new time changes the target with no separate persisted state', () => {
  const round = { play_date: '2026-10-24', tee_time: '08:00' }
  const before = computeTarget(round, null)
  const changedRound = { play_date: '2026-10-24', tee_time: '10:30' }
  const after = computeTarget(changedRound, null)
  assert.notEqual(before?.date.getTime(), after?.date.getTime())
  assert.equal(after?.date.getHours(), 10)
})

test('day-boundary behaviour — calendar-day diff avoids off-by-one from partial days', () => {
  // 23 hours and 59 minutes into "tomorrow" by wall-clock, but still
  // only a 1-calendar-day difference — must not round up to 2.
  const now = new Date(2026, 7, 10, 0, 1) // Aug 10, 00:01 local
  const almostTwoFullDays = new Date(2026, 7, 11, 23, 59) // Aug 11, 23:59 local — still "tomorrow" by calendar date
  const diff = daysBetweenCalendarDates(now, almostTwoFullDays)
  assert.equal(diff, 1)
})

test('day-boundary behaviour — a target exactly one full calendar day later is TOMORROW, not 2 days', () => {
  const now = new Date(2026, 7, 10, 23, 0) // 11pm today
  const target = new Date(2026, 7, 11, 1, 0) // 1am tomorrow — only 2 hours away, but a real calendar-day boundary was crossed
  const diff = daysBetweenCalendarDates(now, target)
  assert.equal(diff, 1)
  assert.equal(iso(now) !== iso(target), true)
})
