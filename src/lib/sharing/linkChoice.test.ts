import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chooseLink } from './linkChoice'
import { isPublicRoute } from '@/lib/auth/publicRoutes'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const TOKEN = 'a'.repeat(43)
const base = { publicUrl: `https://app.test/s/${TOKEN}`, origin: 'https://app.test', tripId: 'trip1' }

test('public sharing ON: the link shown is the /s/ token link and it is public', () => {
  const c = chooseLink({ ...base, isPublic: true })
  assert.equal(c.kind, 'public'); assert.equal(c.url, base.publicUrl); assert.equal(c.warning, null)
  assert.equal(isPublicRoute(new URL(c.url).pathname), true)
})

test('public sharing OFF: the link is members-only, is labelled so, and warns it needs sign-in', () => {
  const c = chooseLink({ ...base, isPublic: false })
  assert.equal(c.kind, 'members'); assert.equal(c.url, 'https://app.test/trips/trip1/presentation')
  assert.equal(isPublicRoute(new URL(c.url).pathname), false) // signed-out visitors are sent to /login
  assert.match(c.heading, /Members-only/); assert.match(c.copyLabel, /members-only/)
  assert.match(c.warning ?? '', /asked to sign in/)
})

test('a members link is never labelled shareable/public', () => {
  const c = chooseLink({ ...base, isPublic: false })
  assert.doesNotMatch(c.heading + c.copyLabel, /shareable|public (viewing )?link|opens without/i)
})

test('panel uses the helper, keeps the explicit acknowledgement and never defaults public on', () => {
  const p = read('src/components/memories/SharePresentationPanel.tsx')
  assert.match(p, /chooseLink\(/)
  assert.match(p, /useState\(false\)\s*\n?\s*const \[attestCleared/)           // publicEnabled default false
  assert.match(p, /canPublish = [^\n]*\(!publicEnabled \|\| attestCleared\)/)  // acknowledgement still required
  assert.match(p, /Share with anyone who has the link \(no sign-in needed\)/)
})

test('public viewer path stays outside login and unrelated routes stay protected', () => {
  assert.equal(isPublicRoute(`/s/${TOKEN}`), true)
  assert.equal(isPublicRoute(`/api/s/${TOKEN}/m/11111111-1111-1111-1111-111111111111`), true)
  for (const p of ['/trips/1/presentation', '/trips/1/memories', '/api/trips/1/share-presentation', '/api/trips/1/presentation/media/2']) assert.equal(isPublicRoute(p), false, p)
})

test('public viewer makes no authenticated calls and reads only the public deck of an active, public-enabled publication', () => {
  const v = read('src/components/memories/SharedPresentationViewer.tsx')
  assert.doesNotMatch(v, /fetch\(|supabase|useRouter|\/login/)
  const page = read('src/app/s/[token]/page.tsx')
  assert.match(page, /\.eq\('status', 'active'\)\.eq\('public_enabled', true\)/)
  assert.doesNotMatch(page, /event_deck/)
  const media = read('src/app/api/s/[token]/m/[momentId]/route.ts')
  assert.match(media, /approved_public_moment_ids/); assert.match(media, /\.eq\('public_enabled', true\)/)
})
