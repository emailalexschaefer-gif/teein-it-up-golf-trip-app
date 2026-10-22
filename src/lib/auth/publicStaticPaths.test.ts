import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPublicStaticPath } from './publicStaticPaths'

// Phase A-2 — static public files skip the middleware auth round trip;
// every app/API route must still go through it.

const PUBLIC = [
  '/brand/logo-new.png', '/brand/icon-192.png', '/brand/logo-new-960.webp',
  '/images/event-highlights-opening.jpg', '/images/generic-slide-template.jpg',
  '/manifest.json', '/sw.js', '/favicon.ico', '/favicon-32.png', '/robots.txt',
  '/_next/static/chunks/app.js',
]

const PROTECTED = [
  '/', '/login', '/dashboard', '/me', '/admin', '/onboarding',
  '/trips/abc', '/trips/abc/rounds/r1', '/trips/abc/scorecard',
  '/api/scores', '/api/trips/abc/messages', '/api/trips/abc/rounds/r1/my-scores',
  '/api/me', '/api/admin/x', '/join/abc', '/auth/callback',
  // look-alikes: must NOT be treated as public static
  '/brand', '/brandy/x', '/images', '/imagesx/y', '/api/brand/x', '/api/images/x',
  '/trips/abc/images/x.jpg', '/manifest.json.bak', '/sw.json', '/swXjs',
]

test('isPublicStaticPath: public files are recognised', () => {
  for (const p of PUBLIC) assert.equal(isPublicStaticPath(p), true, p)
})

test('isPublicStaticPath: app pages, APIs and look-alike paths are NOT public static', () => {
  for (const p of PROTECTED) {
    // '/manifest.json.bak' starts with a public exact path only by prefix; exact match required.
    assert.equal(isPublicStaticPath(p), false, p)
  }
})

// The middleware matcher is a string literal that Next reads statically, so
// it can't import the helper. Pin it to the same behaviour by evaluating the
// real matcher text from middleware.ts.
function loadMatcherRegex(): RegExp {
  const src = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
  const m = src.match(/matcher:\s*\[\s*'([^']+)'\s*\]/)
  assert.ok(m, 'matcher literal not found in middleware.ts')
  const literal = m![1].replace(/\\\\/g, '\\')
  return new RegExp('^' + literal + '$')
}

test('middleware matcher skips every public static file (middleware never runs for them)', () => {
  const re = loadMatcherRegex()
  for (const p of ['/brand/logo-new.png', '/images/generic-slide-template.jpg', '/manifest.json', '/sw.js', '/favicon.ico', '/_next/static/x.js']) {
    assert.equal(re.test(p), false, `${p} should be excluded from middleware`)
  }
})

test('middleware matcher still runs for every page and API route (auth preserved)', () => {
  const re = loadMatcherRegex()
  for (const p of ['/', '/login', '/dashboard', '/trips/abc', '/trips/abc/scorecard', '/api/scores', '/api/trips/abc/messages', '/api/trips/abc/rounds/r1/my-scores', '/me', '/admin', '/brand', '/images', '/api/brand/x', '/api/images/x']) {
    assert.equal(re.test(p), true, `${p} must still pass through middleware`)
  }
})

test('middleware no longer logs per request or prints cookie names', () => {
  const src = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
  assert.equal(/console\.log/.test(src), false)
  assert.equal(/cookies:\s*request\.cookies\.getAll\(\)\.map/.test(src), false)
})

test('middleware still redirects unauthenticated users off protected routes and keeps the auth call', () => {
  const src = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('supabase.auth.getUser()'))
  assert.ok(src.includes("url.pathname = '/login'"))
  assert.ok(src.includes('if (!user && !isPublic)'))
})
