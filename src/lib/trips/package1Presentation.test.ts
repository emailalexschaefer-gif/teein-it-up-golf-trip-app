import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  buildPresentationDeck, defaultPresentationConfig, resolveSelectedMomentIds, isPresentationPhotoCandidate, presentationPhotoCoverage,
  type PresentationConfig, type Slide,
} from './slideshowDeck'
import type { EventMemoryData } from './eventMemoryData'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

type Mem = EventMemoryData['memories'][number]
function memory(o: Partial<Mem> & { momentId: string }): Mem {
  return {
    roundId: null, roundOrdinal: null, holeNumber: null, playerId: 'p1', playerName: null, capturedBy: null, capturedByName: null, caption: null,
    imagePath: 'x.jpg', imageUrl: 'https://signed.example/x.jpg', audience: 'everyone', createdAt: '2026-10-24T10:00:00Z', organiserFavourite: false,
    sourceType: 'GENERAL', sideCompId: null, sideCompName: null, sideCompType: null, mediaType: 'photo', durationSeconds: null, isBlooper: false, aftershowIncluded: null, ...o,
  }
}
function round(id: string, ordinal: number): EventMemoryData['rounds'][number] {
  return { id, ordinal, name: `Round ${ordinal}`, courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18, publishedHighlights: null, winners: null, standings: null, cumulativeStandings: null, cumulativeRoundsIncluded: null } as EventMemoryData['rounds'][number]
}
function data(memories: Mem[], champion: EventMemoryData['results']['champion'] = null, extra: Partial<EventMemoryData['event']> = {}): EventMemoryData {
  return {
    event: { id: 't1', name: 'Lappen Invitational', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-25', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null, ...extra } as EventMemoryData['event'],
    rounds: [round('r1', 1), round('r2', 2)], memories, sideGameWinners: [], sideGameCount: 0, playerCount: 20, results: { champion },
  } as EventMemoryData
}
const photos = (slides: Slide[]) => slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
const kinds = (slides: Slide[]) => slides.map(s => s.kind)
function cfg(d: EventMemoryData, source: PresentationConfig['bestMomentsSource'], scope: PresentationConfig['scope'] = { kind: 'fullEvent' }, selected?: string[]): PresentationConfig {
  return { ...defaultPresentationConfig(d, scope), bestMomentsSource: source, selectedMomentIds: selected }
}

const mems = [
  memory({ momentId: 'r1a', roundId: 'r1', createdAt: '2026-10-24T09:00:00Z' }),
  memory({ momentId: 'r2a', roundId: 'r2', createdAt: '2026-10-25T09:00:00Z' }),
  memory({ momentId: 'ev1', roundId: null, createdAt: '2026-10-24T18:00:00Z' }),
  memory({ momentId: 'ev2', roundId: null, createdAt: '2026-10-25T19:00:00Z', organiserFavourite: true }),
]

// ── Item 4: missing photos ──────────────────────────────────────────────
test('All Memories (full event) includes every photo, including event-level photos that have no round', () => {
  const d = data(mems); const deck = buildPresentationDeck(d, cfg(d, 'all'))
  assert.deepEqual([...photos(deck.slides)].sort(), ['ev1', 'ev2', 'r1a', 'r2a'])
  assert.equal(new Set(photos(deck.slides)).size, photos(deck.slides).length, 'no duplicates')
})

test('event-level photos sit under one divider after the opening and before the first round (older builder placement)', () => {
  const d = data(mems); const k = kinds(buildPresentationDeck(d, cfg(d, 'all')).slides)
  const div = k.indexOf('eventDivider'); const r1 = k.indexOf('roundDivider')
  assert.ok(div > k.indexOf('opening') && div < r1, k.join(','))
  assert.equal(k.filter(x => x === 'eventDivider').length, 1)
})

test('Favourites and Choose Memories also honour event-level photos; unselected ones stay out', () => {
  const d = data(mems)
  assert.deepEqual(photos(buildPresentationDeck(d, cfg(d, 'favourites')).slides), ['ev2'])
  assert.deepEqual(photos(buildPresentationDeck(d, cfg(d, 'selected', { kind: 'fullEvent' }, ['ev1', 'r2a'])).slides).sort(), ['ev1', 'r2a'])
})

test('a single-round presentation never pulls in event-level photos', () => {
  const d = data(mems); const deck = buildPresentationDeck(d, cfg(d, 'all', { kind: 'round', roundId: 'r1' }))
  assert.deepEqual(photos(deck.slides), ['r1a'])
  assert.ok(!kinds(deck.slides).includes('eventDivider'))
})

test('with no event-level photos the slide kinds are exactly as before (no divider added)', () => {
  const d = data(mems.filter(m => m.roundId !== null)); const k = kinds(buildPresentationDeck(d, cfg(d, 'all')).slides)
  assert.ok(!k.includes('eventDivider'))
})

test('the selected group photo is not repeated in the event-level block', () => {
  const d = data(mems, null, { groupPhotoMomentId: 'ev1' }); const c = { ...cfg(d, 'all'), groupPhoto: true }
  const deck = buildPresentationDeck(d, c)
  assert.equal(deck.slides.filter(s => s.kind === 'groupPhoto').length, 1)
  assert.ok(!photos(deck.slides).includes('ev1'))
})

test('a round left out of the presentation still leaves its photos out; videos and text are never photo slides', () => {
  const d = data([...mems, memory({ momentId: 'vid', roundId: 'r1', mediaType: 'video' }), memory({ momentId: 'txt', roundId: null, mediaType: 'text' })])
  const c = cfg(d, 'all'); c.rounds = c.rounds.map(r => r.roundId === 'r2' ? { ...r, bestMoments: false } : r)
  const ids = photos(buildPresentationDeck(d, c).slides)
  assert.ok(!ids.includes('r2a') && !ids.includes('vid') && !ids.includes('txt'))
  assert.ok(ids.includes('ev1') && ids.includes('r1a'))
})

test('there is no hidden cap: 250 photos in, 250 photo slides out', () => {
  const many = Array.from({ length: 250 }, (_, i) => memory({ momentId: `m${i}`, roundId: i % 3 === 0 ? null : i % 2 ? 'r1' : 'r2', createdAt: new Date(Date.UTC(2026, 9, 24, 0, 0, i)).toISOString() }))
  const d = data(many); assert.equal(photos(buildPresentationDeck(d, cfg(d, 'all')).slides).length, 250)
})

test('the candidate rule is shared by the resolver, the coverage figure and the organiser screens', () => {
  const d = data(mems); const c = cfg(d, 'all')
  assert.equal(resolveSelectedMomentIds(d, c).size, 4)
  assert.equal(isPresentationPhotoCandidate({ mediaType: 'photo', roundId: null }, c), true)
  assert.equal(isPresentationPhotoCandidate({ mediaType: 'photo', roundId: null }, cfg(d, 'all', { kind: 'round', roundId: 'r1' })), false)
  const cov = presentationPhotoCoverage(d, c, buildPresentationDeck(d, c).slides)
  assert.deepEqual(cov, { candidates: 4, shown: 4, notShown: 0 })
  const page = read('src/app/(app)/trips/[tripId]/memories/page.tsx')
  assert.doesNotMatch(page, /presentationConfig\.rounds\.some\(r => r\.bestMoments && r\.roundId === m\.roundId\)/)
  assert.match(page, /isPresentationPhotoCandidate\(m, presentationConfig\)/)
  assert.match(page, /data-testid="photo-coverage"/)
})

test('a non-winner Side Game photo is a deliberate omission and is counted as "not shown", not as missing', () => {
  const d = data([memory({ momentId: 'sg', roundId: 'r1', sideCompId: 'c1', sideCompName: 'Nearest the Pin', playerId: 'loser', sourceType: 'SIDE_GAME' as Mem['sourceType'] })])
  d.sideGameWinners = [{ sideCompId: 'c1', roundId: 'r1', winnerPlayerId: 'winner', winnerName: 'W', label: 'NTP', holeNumber: 4 } as EventMemoryData['sideGameWinners'][number]]
  const c = cfg(d, 'all'); const deck = buildPresentationDeck(d, c)
  assert.ok(!photos(deck.slides).includes('sg'))
  assert.deepEqual(presentationPhotoCoverage(d, c, deck.slides), { candidates: 1, shown: 0, notShown: 1 })
})

test('media that fails to load never blanks or stops the slideshow, and is traceable', () => {
  const p = read('src/components/memories/EventHighlightsPlayer.tsx')
  assert.match(p, /Photo unavailable/)
  assert.match(p, /console\.warn\('\[presentation\] photo failed to load', \{ momentId: slide\.momentId \}\)/)
  assert.doesNotMatch(p, /if \(!slide \|\| !slide\.imageUrl\) return null/)
})

// ── Items 1–3: audio layer restored, licensing respected ─────────────────
test('music file is shipped; the unlicensed applause file is not (and the flag defaults off)', () => {
  assert.ok(existsSync(join(ROOT, 'public/audio/funky-clubhouse-mix.mp3')))
  assert.ok(!existsSync(join(ROOT, 'public/audio/celebration-applause.mp3')))
  assert.ok(!existsSync(join(ROOT, 'local-test-assets/celebration-applause.mp3')))
  assert.match(read('src/lib/presentation/audioConfig.ts'), /NEXT_PUBLIC_PRESENTATION_APPLAUSE === 'on'/)
})

test('the player is wired to the audio layer and /audio/ is reachable without signing in (public viewers hear the music)', () => {
  const p = read('src/components/memories/EventHighlightsPlayer.tsx')
  assert.match(p, /usePresentationAudio\(\)/); assert.match(p, /isCelebrationSlide\(current\)/); assert.match(p, /onClickCapture=\{audio\.unlock\}/)
  assert.match(read('src/lib/auth/publicStaticPaths.ts'), /'\/audio\/'/)
  assert.match(read('src/middleware.ts'), /audio\//)
})

test('champion celebration exists only where a champion was declared; ended-early without a champion has none', () => {
  const champ = { champions: [{ playerId: 'p1', playerName: 'Darren H', totalPoints: 71 }], hasTie: false, standings: [{ position: 1, playerId: 'p1', playerName: 'Darren H', totalPoints: 71 }], endedEarly: false } as unknown as NonNullable<EventMemoryData['results']['champion']>
  const none = { champions: [], hasTie: false, standings: [{ position: 1, playerId: 'p1', playerName: 'Darren H', totalPoints: 71 }], endedEarly: true } as unknown as NonNullable<EventMemoryData['results']['champion']>
  const d1 = data(mems, champ); const d2 = data(mems, none)
  assert.ok(kinds(buildPresentationDeck(d1, cfg(d1, 'all')).slides).includes('champion'))
  const k2 = kinds(buildPresentationDeck(d2, cfg(d2, 'all')).slides)
  assert.ok(!k2.includes('champion')); assert.ok(k2.includes('leaderboard'))
  assert.match(read('src/lib/presentation/celebrationTrigger.ts'), /slide\?\.kind === 'champion'/)
})

// ── Item 5: controls ──────────────────────────────────────────────────────
test('controls start hidden and a slide change never reveals them', () => {
  const p = read('src/components/memories/EventHighlightsPlayer.tsx')
  assert.match(p, /useState\(false\)/); assert.match(p, /const \[controlsVisible, setControlsVisible\] = useState\(false\)/)
  const bump = p.slice(p.indexOf('const bumpControls'), p.indexOf('const bumpControls') + 300)
  assert.match(bump, /setControlsVisible\(true\)/)
  assert.doesNotMatch(p, /useEffect\(\(\) => \{ bumpControls\(\) \}, \[/)
})

// ── Item 6: private vs public ────────────────────────────────────────────
test('private presentation: members-only page and media check membership; /trips/* is not a public route', () => {
  assert.match(read('src/app/(app)/trips/[tripId]/presentation/page.tsx'), /getMemberRole\(admin, tripId, user\.id\)/)
  const media = read('src/app/api/trips/[tripId]/presentation/media/[momentId]/route.ts')
  assert.match(media, /getMemberRole/); assert.match(media, /approved_event_moment_ids/)
})

test('public presentation: only an active, public-enabled publication is served, from the public deck and approved ids; publishing is organiser-only and needs the acknowledgement', () => {
  const page = read('src/app/s/[token]/page.tsx'); assert.match(page, /\.eq\('public_enabled', true\)/); assert.match(page, /public_deck/); assert.doesNotMatch(page, /event_deck/)
  const route = read('src/app/api/trips/[tripId]/share-presentation/route.ts')
  assert.match(route, /!== 'organiser'/); assert.match(route, /body\.publicEnabled && !body\.attestCleared/)
  assert.match(route, /public_enabled: body\.publicEnabled/)
})

test('public sharing is separate from marketing use of event content (no marketing flag is read or written by sharing)', () => {
  for (const f of ['src/app/api/trips/[tripId]/share-presentation/route.ts', 'src/app/s/[token]/page.tsx', 'src/lib/sharing/publish.ts', 'src/lib/sharing/eligibility.ts']) assert.doesNotMatch(read(f), /marketing/i, f)
})
