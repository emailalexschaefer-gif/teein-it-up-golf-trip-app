import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicRoute } from './publicRoutes'

test('existing public routes stay public', () => {
  for (const p of ['/', '/login', '/signup', '/auth/callback', '/reset-password', '/join/abc', '/api/auth/callback', '/_next/x', '/favicon.ico', '/manifest.json', '/sw.js', '/brand/a.png'])
    assert.equal(isPublicRoute(p), true, p)
})
test('shared presentation viewer and its media are public', () => {
  assert.equal(isPublicRoute('/s/' + 'a'.repeat(43)), true)
  assert.equal(isPublicRoute('/api/s/' + 'a'.repeat(43) + '/m/123'), true)
})
test('public live leaderboard page and data endpoint are public', () => {
  assert.equal(isPublicRoute('/l/' + 'a'.repeat(43)), true)
  assert.equal(isPublicRoute('/api/l/' + 'a'.repeat(43)), true)
})
test('nothing else opens: member routes, share management and consent stay private', () => {
  for (const p of ['/trips/1/presentation', '/api/trips/1/share-presentation', '/api/trips/1/presentation/media/2', '/api/trips/1/presentation-consent', '/dashboard', '/api/trips/1/messages', '/s', '/sx/abc', '/api/s', '/api/share', '/api/sx/1', '/trips/1/s/abc', '/l', '/lx/abc', '/api/l', '/api/lx/1', '/api/trips/1/share-leaderboard', '/api/trips/1/leaderboard-snapshot', '/trips/1/leaderboard'])
    assert.equal(isPublicRoute(p), false, p)
})
