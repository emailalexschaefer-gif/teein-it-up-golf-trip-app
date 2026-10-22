import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateShareToken, isPlausibleShareToken } from './token'
import { abbreviateName, abbreviateNamesDeep } from './names'
import { computeEligibility, type EligibilityFacts } from './eligibility'
import { buildSnapshot, resolveMediaMarkers, sanitizeDeckStrings, markerFor } from './snapshot'
import { defaultPresentationConfig, buildPresentationDeck } from '@/lib/trips/slideshowDeck'
import type { EventMemoryData } from '@/lib/trips/eventMemoryData'

type Mem = EventMemoryData['memories'][number]
function mem(o: Partial<Mem> & { momentId: string }): Mem {
  return {
    roundId: 'r1', roundOrdinal: 1, holeNumber: null, playerId: 'alex', playerName: 'Alex Smith',
    capturedBy: 'alex', capturedByName: 'Alex Smith', caption: null,
    imagePath: 'secret/bucket/path.jpg', imageUrl: 'https://signed.example/x?token=SECRET', audience: 'everyone',
    createdAt: '2026-10-24T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null,
    mediaType: 'photo', durationSeconds: null, isBlooper: false, aftershowIncluded: null, ...o,
  }
}
function data(memories: Mem[], extra: Partial<EventMemoryData> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Lappen Invitational', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-24', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
    rounds: [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18, publishedHighlights: null,
      winners: [{ playerId: 'alex', playerName: 'Alex Smith', points: 40 }], standings: null, cumulativeStandings: null }],
    memories, sideGameWinners: [], sideGameCount: 0, playerCount: 3,
    results: { champion: { champions: [{ playerId: 'alex', playerName: 'Alex Smith', totalPoints: 40 }], hasTie: false, standings: [] } },
    ...extra,
  }
}
const facts = (o: Partial<EligibilityFacts> = {}): EligibilityFacts => ({ publicEnabled: true, excludedMomentIds: new Set(), ...o })

test('tokens are 43 chars, unique and shape-checked', () => {
  const a = generateShareToken(), b = generateShareToken()
  assert.equal(a.length, 43); assert.notEqual(a, b)
  assert.ok(isPlausibleShareToken(a))
  for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '/', null, 5]) assert.equal(isPlausibleShareToken(bad), false)
})

test('names abbreviate surnames deeply without mutating input', () => {
  assert.equal(abbreviateName('Alex Smith'), 'Alex S.'); assert.equal(abbreviateName('Daz'), 'Daz')
  const src = { a: ['Alex Smith won'], b: { c: 'Ann Lee-Smith & Alex Smith' } }
  const out = abbreviateNamesDeep(src, ['Alex Smith', 'Ann Lee-Smith'])
  assert.deepEqual(out, { a: ['Alex S. won'], b: { c: 'Ann L. & Alex S.' } })
  assert.equal(src.a[0], 'Alex Smith won')
})

test('eligibility: group-only and text are never included; organiser exclusions removed from public only', () => {
  const d = data([mem({ momentId: 'ok' }), mem({ momentId: 'disputed' }), mem({ momentId: 'grp', audience: 'group' }), mem({ momentId: 'txt', mediaType: 'text' }), mem({ momentId: 'vid', mediaType: 'video' })])
  const e = computeEligibility(d, facts({ excludedMomentIds: new Set(['disputed']) }))
  assert.deepEqual(e.eventMomentIds, ['ok', 'disputed', 'vid'])
  assert.deepEqual(e.publicMomentIds, ['ok', 'vid'])
  const reason = (id: string) => e.publicExcluded.find(x => x.momentId === id)?.reason
  assert.equal(reason('disputed'), 'organiser_excluded'); assert.equal(reason('grp'), 'group_only'); assert.equal(reason('txt'), 'not_photo_or_video')
})

test('public sharing off: nothing is public, event members still get the full set, public deck is empty', () => {
  const d = data([mem({ momentId: 'ok', organiserFavourite: true })])
  const e = computeEligibility(d, facts({ publicEnabled: false }))
  assert.deepEqual(e.publicMomentIds, []); assert.deepEqual(e.eventMomentIds, ['ok'])
  const snap = buildSnapshot({ data: d, config: defaultPresentationConfig(d, { kind: 'fullEvent' }), facts: facts({ publicEnabled: false }), nameMode: 'initials' })
  assert.equal(snap.publicDeck.slides.length, 0); assert.deepEqual(snap.approvedPublicMomentIds, [])
  assert.ok(snap.eventDeck.slides.length > 0)
})

test('snapshot: no signed URLs, storage paths or consenting-only leakage; public hides unapproved photos and abbreviates names', () => {
  const d = data([mem({ momentId: 'ok', organiserFavourite: true, caption: 'Alex Smith nails it' }), mem({ momentId: 'bobs', playerId: 'bob', capturedBy: 'bob', playerName: 'Bob Jones', organiserFavourite: true })],
    { event: { ...data([]).event, championPhotoMomentId: 'bobs' } })
  const config = defaultPresentationConfig(d, { kind: 'fullEvent' })
  const snap = buildSnapshot({ data: d, config, facts: facts({ excludedMomentIds: new Set(['bobs']) }), nameMode: 'initials' })
  const pub = JSON.stringify(snap.publicDeck), ev = JSON.stringify(snap.eventDeck)
  for (const s of [pub, ev]) {
    assert.ok(!s.includes('signed.example')); assert.ok(!s.includes('SECRET')); assert.ok(!s.includes('secret/bucket'))
  }
  assert.ok(pub.includes(markerFor('ok'))); assert.ok(!pub.includes(markerFor('bobs')))
  assert.ok(ev.includes(markerFor('bobs')))
  assert.ok(!pub.includes('Alex Smith')); assert.ok(pub.includes('Alex S.'))
  assert.ok(ev.includes('Alex Smith'))
  assert.deepEqual(snap.approvedPublicMomentIds, ['ok']); assert.deepEqual(snap.approvedEventMomentIds.sort(), ['bobs', 'ok'])
  // winner/champion slide survives without the unapproved photo
  assert.ok(snap.publicDeck.slides.some(s => s.kind === 'eventChampion' || /champion/i.test(s.kind)))
})

test('snapshot with full name mode keeps full names', () => {
  const d = data([mem({ momentId: 'ok' })])
  const snap = buildSnapshot({ data: d, config: defaultPresentationConfig(d, { kind: 'fullEvent' }), facts: facts(), nameMode: 'full' })
  assert.ok(JSON.stringify(snap.publicDeck).includes('Alex Smith'))
})

test('snapshot deck matches the existing engine for the same approved data (same renderer, same structure)', () => {
  const d = data([mem({ momentId: 'ok', organiserFavourite: true })])
  const config = defaultPresentationConfig(d, { kind: 'fullEvent' })
  const snap = buildSnapshot({ data: d, config, facts: facts(), nameMode: 'full' })
  const direct = buildPresentationDeck({ ...d, memories: d.memories.map(m => ({ ...m, imagePath: '', imageUrl: markerFor(m.momentId) })) }, config)
  assert.deepEqual(snap.publicDeck.slides.map(s => s.kind), direct.slides.map(s => s.kind))
})

test('resolveMediaMarkers: allowed ids resolve, others and raw URLs become null', () => {
  const deck = { slides: [{ kind: 'photo', imageUrl: markerFor('a') }, { kind: 'photo', imageUrl: markerFor('b') }, { kind: 'photo', imageUrl: 'https://evil/x.jpg' }, { kind: 'x', caption: 'https://ok text' }] }
  const out = resolveMediaMarkers(deck, new Set(['a']), id => `/m/${id}`)
  assert.deepEqual(out.slides.map(s => (s as { imageUrl?: string | null }).imageUrl), ['/m/a', null, null, undefined])
  assert.equal((out.slides[3] as { caption: string }).caption, 'https://ok text')
})

test('sanitizeDeckStrings drops non-marker url-like fields', () => {
  assert.deepEqual(sanitizeDeckStrings({ heroImageUrl: 'https://x', winnerImageUrl: markerFor('a'), name: 'n' }), { heroImageUrl: null, winnerImageUrl: markerFor('a'), name: 'n' })
})

test('share tokens never reach analytics paths', async () => {
  const { sanitizePagePath } = await import('@/lib/analytics/trackEvent')
  const { normaliseRoute } = await import('@/lib/perf/perfMetrics')
  const t = 'abcDEF_-ghiJKL_-mnoPQR_-stuVWX_-yzaBCD_-efg'
  assert.equal(sanitizePagePath(`/s/${t}`), '/s/:token')
  assert.equal(normaliseRoute(`/s/${t}`), '/s/:token')
  assert.equal(normaliseRoute(`https://x.app/api/s/${t}/m/5`).includes(t), false)
})

test('chat message round-trips and only the exact automatic post is recognised', async () => {
  const { buildPresentationChatMessage, parsePresentationChatMessage } = await import('./chatMessage')
  const token = generateShareToken()
  const msg = buildPresentationChatMessage('Lappen Invitational', `https://teeinitup.app/s/${token}`)
  assert.ok(msg.startsWith('Relive the memories! ⛳🏆\nWhat a great event! Revisit the highlights, winners, laughs and unforgettable Moments from the Lappen Invitational.\nWatch our Event Presentation\n'))
  const p = parsePresentationChatMessage(msg)
  assert.equal(p?.token, token)
  assert.equal(parsePresentationChatMessage(`hello https://x/s/${token}`), null)
  assert.equal(parsePresentationChatMessage(msg.replace('Watch our', 'Watch my')), null)
  assert.equal(parsePresentationChatMessage('Relive the memories! ⛳🏆\nx\nWatch our Event Presentation\nhttps://x/s/short'), null)
})

test('removing a winner’s photo keeps every award slide: names and results stay, photo falls back to artwork', () => {
  const photos = [
    mem({ momentId: 'champ-photo', playerId: 'alex', capturedBy: 'alex', organiserFavourite: false }),
    mem({ momentId: 'sg-photo', playerId: 'bob', playerName: 'Bob Jones', capturedBy: 'bob', sourceType: 'SIDE_GAME', sideCompId: 'sc1', sideCompName: 'Nearest the Pin', sideCompType: 'nearest_pin', holeNumber: 7, organiserFavourite: true }),
    mem({ momentId: 'other', playerId: 'cat', playerName: 'Cat Lee', capturedBy: 'cat', organiserFavourite: true }),
  ]
  const base = data(photos)
  const d = data(photos, {
    event: { ...base.event, championPhotoMomentId: 'champ-photo' },
    sideGameWinners: [{ sideCompId: 'sc1', roundId: 'r1', compType: 'nearest_pin', label: 'Nearest the Pin', holeNumber: 7, winnerPlayerId: 'bob', winnerName: 'Bob Jones' }],
    sideGameCount: 1,
    rounds: [{ ...base.rounds[0], standings: [{ playerId: 'alex', playerName: 'Alex Smith', roundPoints: 40, position: 1 }] }],
  })
  const config = defaultPresentationConfig(d, { kind: 'fullEvent' })
  const snap = buildSnapshot({ data: d, config, facts: facts({ excludedMomentIds: new Set(['champ-photo', 'sg-photo']) }), nameMode: 'initials' })

  const champ = snap.publicDeck.slides.find(s => s.kind === 'champion')
  assert.ok(champ && champ.kind === 'champion', 'champion slide must remain')
  assert.equal(champ.photoUrl, null)
  assert.equal(champ.champions[0].playerName, 'Alex S.'); assert.equal(champ.champions[0].totalPoints, 40)

  const sg = snap.publicDeck.slides.find(s => s.kind === 'sideGameWinner')
  assert.ok(sg && sg.kind === 'sideGameWinner', 'side-game winner slide must remain')
  assert.equal(sg.winnerImageUrl, null); assert.equal(sg.winnerName, 'Bob J.'); assert.equal(sg.label, 'Nearest the Pin')

  const rr = snap.publicDeck.slides.find(s => s.kind === 'roundResults')
  assert.ok(rr && rr.kind === 'roundResults' && rr.standings[0].roundPoints === 40, 'round results remain')

  // the members' version still shows the real photos
  const evChamp = snap.eventDeck.slides.find(s => s.kind === 'champion')
  assert.ok(evChamp && evChamp.kind === 'champion' && evChamp.photoUrl === markerFor('champ-photo'))
  const evSg = snap.eventDeck.slides.find(s => s.kind === 'sideGameWinner')
  assert.ok(evSg && evSg.kind === 'sideGameWinner' && evSg.winnerImageUrl === markerFor('sg-photo'))
  // and the removed photos are nowhere in the public deck
  assert.ok(!JSON.stringify(snap.publicDeck).includes('champ-photo')); assert.ok(!JSON.stringify(snap.publicDeck).includes('sg-photo'))
})
