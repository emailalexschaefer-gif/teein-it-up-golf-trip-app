import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizePagePath } from './trackEvent'

// GA4 / Product Analytics brief, section 5 — the one concrete PII leak
// found while wiring this up: the invite code appears directly in the
// /join/[code] URL path, and as an ?inviteCode= query param elsewhere.

test('sanitizePagePath — redacts the invite code from /join/[code]', () => {
  assert.equal(sanitizePagePath('/join/ABC123XY'), '/join/:code')
})

test('sanitizePagePath — redacts /join/[code] even with a trailing query string', () => {
  assert.equal(sanitizePagePath('/join/ABC123XY?foo=bar'), '/join/:code?foo=bar')
})

test('sanitizePagePath — strips inviteCode query param on other pages, case-insensitively', () => {
  assert.equal(sanitizePagePath('/login?inviteCode=ABC123'), '/login')
  assert.equal(sanitizePagePath('/login?InviteCode=ABC123'), '/login')
})

test('sanitizePagePath — strips code/token/access_token/refresh_token query params', () => {
  assert.equal(sanitizePagePath('/auth/callback?code=xyz'), '/auth/callback')
  assert.equal(sanitizePagePath('/reset-password?token=abc'), '/reset-password')
  assert.equal(sanitizePagePath('/foo?access_token=abc&refresh_token=def'), '/foo')
})

test('sanitizePagePath — preserves genuinely non-sensitive query params', () => {
  assert.equal(sanitizePagePath('/login?mode=password'), '/login?mode=password')
})

test('sanitizePagePath — strips a sensitive param while preserving a non-sensitive one on the same page', () => {
  assert.equal(sanitizePagePath('/login?inviteCode=ABC123&mode=password'), '/login?mode=password')
})

test('sanitizePagePath — a plain path with no query string and no /join/ segment is untouched', () => {
  assert.equal(sanitizePagePath('/dashboard'), '/dashboard')
  assert.equal(sanitizePagePath('/trips/abc-123-uuid'), '/trips/abc-123-uuid')
})

test('sanitizePagePath — a /join/ path segment elsewhere in the URL (not the actual route) is not falsely redacted', () => {
  // Guards against an overly broad regex — only the leading /join/[code]
  // route itself should ever be redacted.
  assert.equal(sanitizePagePath('/trips/join-the-club-event'), '/trips/join-the-club-event')
})
