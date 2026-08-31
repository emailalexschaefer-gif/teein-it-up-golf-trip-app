import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMostRecentTrip } from './selectMostRecentTrip'

test('selectMostRecentTrip — empty list returns null', () => {
  assert.equal(selectMostRecentTrip([]), null)
})

test('selectMostRecentTrip — a single trip is returned regardless of status', () => {
  assert.equal(selectMostRecentTrip([{ tripId: 'a', status: 'completed', updatedAt: '2026-01-01' }]), 'a')
})

test('selectMostRecentTrip — prefers an active (live/ready/open) trip over a more recently updated completed one', () => {
  const result = selectMostRecentTrip([
    { tripId: 'completed-newer', status: 'completed', updatedAt: '2026-06-01' },
    { tripId: 'live-older', status: 'live', updatedAt: '2026-01-01' },
  ])
  assert.equal(result, 'live-older')
})

test('selectMostRecentTrip — among multiple active trips, picks the most recently updated', () => {
  const result = selectMostRecentTrip([
    { tripId: 'open-older', status: 'open', updatedAt: '2026-01-01' },
    { tripId: 'ready-newer', status: 'ready', updatedAt: '2026-06-01' },
  ])
  assert.equal(result, 'ready-newer')
})

test('selectMostRecentTrip — with no active trips, falls back to the most recently updated completed/archived one', () => {
  const result = selectMostRecentTrip([
    { tripId: 'completed-older', status: 'completed', updatedAt: '2026-01-01' },
    { tripId: 'completed-newer', status: 'completed', updatedAt: '2026-06-01' },
    { tripId: 'archived-newest', status: 'archived', updatedAt: '2026-07-01' },
  ])
  assert.equal(result, 'archived-newest')
})

test('selectMostRecentTrip — draft trips are treated as inactive, not preferred over a live one', () => {
  const result = selectMostRecentTrip([
    { tripId: 'draft-newer', status: 'draft', updatedAt: '2026-06-01' },
    { tripId: 'live-older', status: 'live', updatedAt: '2026-01-01' },
  ])
  assert.equal(result, 'live-older')
})
