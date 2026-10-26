// Package 1 correction (26 Oct) -- photo / caption / timer synchronisation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SlideMediaLoader, requiredImageUrl, withoutImage, urlsToPreload, contentReady,
  MEDIA_TIMEOUT_MS, PRELOAD_AHEAD,
} from './slideMedia'
import type { Slide } from '../trips/slideshowDeck'

const photo = (id: string, url: string | null): Slide => ({
  kind: 'photo', momentId: id, imageUrl: url, caption: 'c', roundName: null, holeNumber: null,
  playerName: null, sourceType: 'manual' as never, sideCompName: null, organiserFavourite: false,
})
const winner = (url: string | null): Slide => ({ kind: 'sideGameWinner', sideCompId: 's', label: 'NTP', holeNumber: 3, winnerName: 'W', winnerImageUrl: url })
const champion = (url: string | null): Slide => ({ kind: 'champion', champions: [{ playerId: 'p', playerName: 'P', totalPoints: 9 }], hasTie: false, photoUrl: url })
const group = (url: string | null): Slide => ({ kind: 'groupPhoto', momentId: 'g', imageUrl: url, caption: null })
const blooperPhoto = (url: string | null): Slide => ({ kind: 'blooper', momentId: 'b', mediaType: 'photo', imageUrl: url, durationSeconds: null, playerName: null, caption: null })
const blooperVideo: Slide = { kind: 'blooper', momentId: 'v', mediaType: 'video', imageUrl: 'v.jpg', durationSeconds: 5, playerName: null, caption: null }

function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const tick = () => new Promise(r => setImmediate(r))

test('requiredImageUrl: every slide kind that draws a picture names it; others need nothing', () => {
  assert.equal(requiredImageUrl(photo('a', 'a.jpg')), 'a.jpg')
  assert.equal(requiredImageUrl(winner('w.jpg')), 'w.jpg')
  assert.equal(requiredImageUrl(champion('k.jpg')), 'k.jpg')
  assert.equal(requiredImageUrl(group('g.jpg')), 'g.jpg')
  assert.equal(requiredImageUrl(blooperPhoto('b.jpg')), 'b.jpg')
  assert.equal(requiredImageUrl(blooperVideo), null)
  assert.equal(requiredImageUrl({ kind: 'eventDivider' }), null)
  assert.equal(requiredImageUrl(undefined), null)
  assert.equal(requiredImageUrl(winner(null)), null)
})

test('withoutImage removes only the picture', () => {
  const w = withoutImage(winner('w.jpg')) as Extract<Slide, { kind: 'sideGameWinner' }>
  assert.equal(w.winnerImageUrl, null); assert.equal(w.winnerName, 'W')
  assert.equal((withoutImage(champion('k.jpg')) as Extract<Slide, { kind: 'champion' }>).photoUrl, null)
  assert.equal((withoutImage(photo('a', 'a.jpg')) as Extract<Slide, { kind: 'photo' }>).imageUrl, null)
  assert.equal((withoutImage(group('g.jpg')) as Extract<Slide, { kind: 'groupPhoto' }>).imageUrl, null)
  assert.equal((withoutImage(blooperPhoto('b.jpg')) as Extract<Slide, { kind: 'blooper' }>).imageUrl, null)
  assert.equal(withoutImage(blooperVideo), blooperVideo)
  const d: Slide = { kind: 'eventDivider' }; assert.equal(withoutImage(d), d)
})

test('urlsToPreload: next PRELOAD_AHEAD slides, winner/champion/group included, no duplicates, bounded', () => {
  assert.equal(PRELOAD_AHEAD, 2)
  const slides = [photo('0', '0.jpg'), winner('w.jpg'), { kind: 'eventDivider' } as Slide, champion('k.jpg'), group('k.jpg')]
  assert.deepEqual(urlsToPreload(slides, 0), ['w.jpg'])
  assert.deepEqual(urlsToPreload(slides, 1), ['k.jpg'])
  assert.deepEqual(urlsToPreload(slides, 2), ['k.jpg'])
  assert.deepEqual(urlsToPreload(slides, 4), [])
  assert.deepEqual(urlsToPreload(slides, 99), [])
})

test('contentReady: nothing to wait for / ready / failed => true; loading or not yet requested => false', () => {
  assert.equal(contentReady(null, null), true)
  assert.equal(contentReady('a', 'ready'), true)
  assert.equal(contentReady('a', 'failed'), true)
  assert.equal(contentReady('a', 'loading'), false)
  assert.equal(contentReady('a', null), false)
})

test('loader: fetches each url once, reports ready, notifies', async () => {
  let calls = 0, changes = 0; const d = deferred()
  const l = new SlideMediaLoader(() => { calls++; return d.promise }, () => { changes++ })
  assert.equal(l.statusOf('a'), null)
  l.request('a'); l.request('a'); l.request('a', true)
  assert.equal(calls, 1); assert.equal(l.statusOf('a'), 'loading')
  d.resolve(); await tick()
  assert.equal(l.statusOf('a'), 'ready'); assert.equal(changes, 1)
  l.request('a', true); assert.equal(calls, 1)
})

test('loader: a failed load is failed, is not retried by preload, is retried when the viewer returns', async () => {
  let calls = 0; const d1 = deferred(), d2 = deferred(); const ds = [d1, d2]
  const l = new SlideMediaLoader(() => ds[calls++].promise, () => {})
  l.request('a'); d1.reject(new Error('404')); await tick()
  assert.equal(l.statusOf('a'), 'failed')
  l.request('a'); assert.equal(calls, 1)
  l.request('a', true); assert.equal(calls, 2); assert.equal(l.statusOf('a'), 'loading')
  d2.resolve(); await tick(); assert.equal(l.statusOf('a'), 'ready')
})

test('loader: giveUp shows the fallback and a late arrival cannot change it', async () => {
  let changes = 0; const d = deferred()
  const l = new SlideMediaLoader(() => d.promise, () => { changes++ })
  l.request('a'); l.giveUp('a')
  assert.equal(l.statusOf('a'), 'failed'); assert.equal(changes, 1)
  d.resolve(); await tick()
  assert.equal(l.statusOf('a'), 'failed'); assert.equal(changes, 1)
  l.giveUp('a'); assert.equal(changes, 1)
})

test('loader: disposed loader does nothing', async () => {
  let calls = 0, changes = 0; const d = deferred()
  const l = new SlideMediaLoader(() => { calls++; return d.promise }, () => { changes++ })
  l.request('a'); l.dispose(); d.resolve(); await tick()
  assert.equal(changes, 0); l.request('b'); assert.equal(calls, 1)
})

test('timeout is a sensible, bounded wait', () => { assert.ok(MEDIA_TIMEOUT_MS >= 5000 && MEDIA_TIMEOUT_MS <= 15000) })

// ---- wiring pins on the player (the behaviour itself was exercised in a real browser) ----
const player = readFileSync(fileURLToPath(new URL('../../components/memories/EventHighlightsPlayer.tsx', import.meta.url)), 'utf8')

test('player: auto-advance timer only runs once the slide content is ready', () => {
  assert.match(player, /if \(!playing \|\| !slideReady\) return/)
  assert.match(player, /\[[^\]]*slideReady[^\]]*\]/)
})
test('player: champion celebration starts only when the champion slide is revealed', () => {
  assert.match(player, /if \(!onChampionSlide \|\| !slideReady\) return/)
})
test('player: picture, text and label are all gated on slideReady; a loading state is shown otherwise', () => {
  assert.match(player, /\{slideReady && renderPhoto\(/)
  assert.match(player, /\{slideReady && !isPhoto\(current\) && \(\s*<NonPhotoSlide/)
  assert.match(player, /\{!slideReady && \(\s*<div role="status"/)
})
test('player: photo layers are keyed per moment so a previous picture is never reused under a new caption', () => {
  const keyed = player.match(/key=\{slide\.momentId\}/g) ?? []
  assert.ok(keyed.length >= 2)
})
test('player: failed or timed-out photo uses the no-photo layout via withoutImage, with a viewer-side timeout', () => {
  assert.match(player, /withoutImage\(current\)/)
  assert.match(player, /MEDIA_TIMEOUT_MS/)
  assert.match(player, /loader\.giveUp\(currentImageUrl\)/)
})
test('player: controls remain hidden on slide change (slideReady never reveals them)', () => {
  const m = player.match(/bumpControls[^\n]*/g) ?? []
  assert.ok(m.length > 0)
  assert.doesNotMatch(player, /useEffect\([^)]*\{[^}]*bumpControls\(\)[^}]*slideReady/s)
})
