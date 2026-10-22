import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PresentationAudioController, type AudioChannel, type Scheduler } from './audioController'
import { MUSIC_VOLUME, FADE_OUT_MS, FADE_IN_MS, REVEAL_DELAY_MS, FALLBACK_CELEBRATION_MS, CONFETTI_MIN_MS, CONFETTI_MAX_MS } from './audioConfig'
import { isCelebrationSlide } from './celebrationTrigger'
import { buildConfettiPieces, confettiPieces } from '../../components/memories/PresentationConfetti'
import { buildPresentationDeck, defaultPresentationConfig } from '../trips/slideshowDeck'
import type { EventMemoryData } from '../trips/eventMemoryData'

class FakeChannel implements AudioChannel {
  playing = false; volume = -1; loop = false; plays = 0; rewinds = 0; rejectNext = false; dur: number | null = 9430
  private playingCb: (() => void) | null = null
  static live = 0; static maxLive = 0
  durationMs() { return this.dur }
  async play() {
    if (this.rejectNext) { this.rejectNext = false; throw new Error('NotAllowedError') }
    if (!this.playing) { this.playing = true; FakeChannel.live += 1; FakeChannel.maxLive = Math.max(FakeChannel.maxLive, FakeChannel.live) }
    this.plays += 1; queueMicrotask(() => this.playingCb?.())
  }
  pause() { if (this.playing) { this.playing = false; FakeChannel.live -= 1 } }
  rewind() { this.rewinds += 1 }
  setVolume(v: number) { this.volume = v }
  setLoop(on: boolean) { this.loop = on }
  onPlaying(cb: () => void) { this.playingCb = cb }
  dispose() { this.pause() }
  fireStalePlaying() { this.playingCb?.() }
}
class FakeScheduler implements Scheduler {
  now = 0; private id = 0; private timers = new Map<number, { at: number; fn: () => void; every?: number }>()
  setTimeout(fn: () => void, ms: number) { const i = ++this.id; this.timers.set(i, { at: this.now + ms, fn }); return i }
  clearTimeout(h: unknown) { this.timers.delete(h as number) }
  setInterval(fn: () => void, ms: number) { const i = ++this.id; this.timers.set(i, { at: this.now + ms, fn, every: ms }); return i }
  clearInterval(h: unknown) { this.timers.delete(h as number) }
  advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, t] = next; this.now = t.at
      if (t.every) t.at += t.every; else this.timers.delete(id)
      t.fn()
    }
    this.now = end
  }
  get pending() { return this.timers.size }
}
const tick = () => new Promise<void>(r => setImmediate(r))
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

function setup(opts: { applause?: boolean; musicEnabled?: boolean; applauseEnabled?: boolean } = {}) {
  FakeChannel.live = 0; FakeChannel.maxLive = 0
  const music = new FakeChannel(); const applause = opts.applause === false ? null : new FakeChannel(); const sched = new FakeScheduler()
  const reveals: { atMs: number; ms: number; applausePlaying: boolean }[] = []
  const c: PresentationAudioController = new PresentationAudioController({
    music, applause, scheduler: sched, musicVolume: MUSIC_VOLUME, fadeOutMs: FADE_OUT_MS, fadeInMs: FADE_IN_MS, revealDelayMs: REVEAL_DELAY_MS,
    fallbackCelebrationMs: FALLBACK_CELEBRATION_MS, confettiMinMs: CONFETTI_MIN_MS, confettiMaxMs: CONFETTI_MAX_MS,
    musicEnabled: opts.musicEnabled, applauseEnabled: opts.applauseEnabled,
    onReveal: ms => reveals.push({ atMs: sched.now, ms, applausePlaying: applause?.playing ?? false }),
  })
  return { c, music, applause, sched, reveals }
}
async function playing(o: ReturnType<typeof setup>) { await o.c.start(); await tick(); o.sched.advance(1000) }

// ---- background music ----
test('music: nothing plays before a gesture; start() begins ONE looping playback at 25%', async () => {
  const o = setup()
  assert.equal(o.music.playing, false); assert.equal(o.music.loop, true)
  await playing(o)
  assert.equal(o.music.playing, true); assert.equal(o.music.plays, 1); assert.ok(near(o.music.volume, 0.25))
})

test('music: repeated start/unlock/video-state calls on normal slides never restart or double-play', async () => {
  const o = setup(); await playing(o)
  for (let i = 0; i < 25; i++) { await o.c.start(); await o.c.unlock(); o.c.setVideoPlaying(false) }
  assert.equal(o.music.plays, 1); assert.equal(FakeChannel.maxLive, 1); assert.equal(o.music.rewinds, 0)
})

test('music: blocked autoplay is reported, then a later interaction (unlock) starts it', async () => {
  const o = setup(); o.music.rejectNext = true
  await o.c.start()
  assert.equal(o.c.getState().blocked, true); assert.equal(o.music.playing, false)
  await o.c.unlock(); await tick(); o.sched.advance(1000)
  assert.equal(o.c.getState().blocked, false); assert.equal(o.music.playing, true)
})

test('music toggle: off fades out and pauses; on resumes the SAME playback; stored "off" preference is never overridden', async () => {
  const o = setup(); await playing(o)
  o.c.setMusicEnabled(false); o.sched.advance(1000)
  assert.equal(o.music.playing, false); assert.equal(o.music.volume, 0)
  o.c.setMusicEnabled(true); await tick(); o.sched.advance(1000)
  assert.equal(o.music.playing, true); assert.ok(near(o.music.volume, 0.25)); assert.equal(o.music.rewinds, 0)
  const off = setup({ musicEnabled: false }); await off.c.start()
  off.c.celebrate(); off.sched.advance(2000); off.c.endCelebration(); await tick(); off.sched.advance(2000)
  assert.equal(off.music.plays, 0, 'a viewer who switched music off never hears it, even after the champion slide')
})

test('video: audible video fades music out and pauses it; it resumes from the same position after; muted video (no call) leaves music alone', async () => {
  const o = setup(); await playing(o)
  o.c.setVideoPlaying(true); o.sched.advance(FADE_OUT_MS + 100)
  assert.equal(o.music.playing, false)
  o.c.setVideoPlaying(false); await tick(); o.sched.advance(FADE_IN_MS + 100)
  assert.equal(o.music.playing, true); assert.ok(near(o.music.volume, 0.25)); assert.equal(o.music.rewinds, 0)
  const m = setup(); await playing(m)
  m.c.setVideoPlaying(false); m.sched.advance(3000) // a muted video never reports "audible"
  assert.ok(near(m.music.volume, 0.25)); assert.equal(m.music.playing, true)
})

// ---- Overall Champion ----
test('champion: entering fades the music COMPLETELY out (about 0.5 s) and pauses it; nothing else sounds before the reveal', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(FADE_OUT_MS / 2)
  assert.ok(o.music.volume > 0 && o.music.volume < 0.25, 'mid-fade')
  o.sched.advance(FADE_OUT_MS / 2 + 50)
  assert.equal(o.music.volume, 0); assert.equal(o.music.playing, false)
  assert.equal(o.applause!.plays, 0); assert.equal(o.reveals.length, 0, 'no confetti before the soundtrack has stopped')
})

test('champion: applause and confetti start TOGETHER, only after the music has stopped', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  assert.equal(o.applause!.plays, 1); assert.equal(o.reveals.length, 1)
  assert.equal(o.reveals[0].applausePlaying, true, 'confetti starts when applause is genuinely playing')
  assert.equal(o.music.playing, false)
  assert.ok(o.reveals[0].atMs >= o.sched.now - 20 - REVEAL_DELAY_MS)
})

test('champion: confetti duration tracks the applause length (9-10 s clamp, 9.4 s fallback)', async () => {
  for (const [dur, want] of [[9430, 9430], [12000, CONFETTI_MAX_MS], [5000, CONFETTI_MIN_MS], [null, FALLBACK_CELEBRATION_MS]] as const) {
    const o = setup(); o.applause!.dur = dur; await playing(o)
    o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
    assert.equal(o.reveals[0].ms, want, `duration ${dur}`)
  }
})

test('champion: music stays OFF after the applause finishes, until the viewer leaves the slide', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  o.applause!.pause(); o.applause!.fireStalePlaying() // applause ends
  o.sched.advance(120000); await tick()
  assert.equal(o.music.playing, false); assert.equal(o.music.volume, 0)
  assert.equal(o.applause!.plays, 1, 'applause plays once per visit; nothing restarts it')
})

test('champion: re-renders / time passing never replay it; stale "playing" events are ignored', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  for (let i = 0; i < 10; i++) { o.applause!.fireStalePlaying(); await tick(); o.sched.advance(5000) }
  assert.equal(o.reveals.length, 1); assert.equal(o.applause!.plays, 1)
})

test('leaving champion: stops applause, restores music from the SAME position, fading in over ~0.7 s to 25%', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  o.c.endCelebration(); assert.equal(o.applause!.playing, false)
  await tick(); o.sched.advance(FADE_IN_MS / 2)
  assert.ok(o.music.volume > 0 && o.music.volume < 0.25, 'fading in')
  o.sched.advance(FADE_IN_MS)
  assert.equal(o.music.playing, true); assert.ok(near(o.music.volume, 0.25)); assert.equal(o.music.rewinds, 0)
})

test('leaving champion before the applause finishes stops applause immediately and cancels the pending reveal', async () => {
  const early = setup(); await playing(early)
  early.c.celebrate(); early.sched.advance(300); early.c.endCelebration(); early.sched.advance(5000); await tick()
  assert.equal(early.applause!.plays, 0); assert.equal(early.reveals.length, 0)
  const mid = setup(); await playing(mid)
  mid.c.celebrate(); mid.sched.advance(REVEAL_DELAY_MS + 10); await tick(); mid.sched.advance(2000)
  mid.c.endCelebration(); assert.equal(mid.applause!.playing, false)
})

test('revisit: a clean replay, and applause never overlaps', async () => {
  const o = setup(); await playing(o)
  for (let visit = 1; visit <= 3; visit++) {
    o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick(); o.sched.advance(3000)
    o.c.endCelebration(); await tick(); o.sched.advance(2000)
    assert.equal(o.applause!.plays, visit); assert.equal(o.reveals.length, visit)
  }
  assert.equal(o.music.plays, 4, 'initial start + one resume after each of the 3 visits, never doubled')
  assert.equal(FakeChannel.maxLive, 1, 'music and applause are never audible at the same time')
})

test('rapid Champion -> next -> Champion -> next: late timers/callbacks from earlier visits never act; only one celebration', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(400); o.c.endCelebration()
  o.c.celebrate(); o.sched.advance(400); o.c.endCelebration()
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  assert.equal(o.applause!.plays, 1); assert.equal(o.reveals.length, 1)
  o.c.endCelebration(); await tick(); o.sched.advance(2000)
  assert.equal(o.applause!.playing, false); assert.equal(o.music.playing, true); assert.ok(near(o.music.volume, 0.25))
  assert.equal(o.music.rewinds, 0); assert.ok(FakeChannel.maxLive <= 2)
})

test('applause unavailable, switched off or failing: confetti still runs (fallback length), music stays off for the slide, nothing gets stuck', async () => {
  const none = setup({ applause: false }); await playing(none)
  none.c.celebrate(); none.sched.advance(REVEAL_DELAY_MS + 10)
  assert.equal(none.reveals.length, 1); assert.equal(none.reveals[0].ms, FALLBACK_CELEBRATION_MS); assert.equal(none.music.playing, false)
  none.c.endCelebration(); await tick(); none.sched.advance(2000); assert.equal(none.music.playing, true)

  const off = setup({ applauseEnabled: false }); await playing(off)
  off.c.celebrate(); off.sched.advance(REVEAL_DELAY_MS + 10)
  assert.equal(off.applause!.plays, 0); assert.equal(off.reveals.length, 1); assert.equal(off.music.playing, false)

  const blocked = setup(); await playing(blocked)
  blocked.applause!.rejectNext = true
  blocked.c.celebrate(); blocked.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  assert.equal(blocked.reveals.length, 1); assert.equal(blocked.reveals[0].ms, FALLBACK_CELEBRATION_MS)

  const stalled = setup(); await playing(stalled)
  stalled.applause!.play = async () => { /* never reports playing */ }
  stalled.c.celebrate(); stalled.sched.advance(REVEAL_DELAY_MS + 4000); await tick()
  assert.equal(stalled.reveals.length, 1)
})

test('music and celebration sound are independent; muting applause mid-celebration stops it but keeps music held until the slide is left', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick()
  o.c.setApplauseEnabled(false)
  assert.equal(o.applause!.playing, false); o.sched.advance(5000); assert.equal(o.music.playing, false)
  o.c.endCelebration(); await tick(); o.sched.advance(2000); assert.equal(o.music.playing, true)
})

test('video playing while on the champion slide never brings the music back', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(2000)
  o.c.setVideoPlaying(true); o.c.setVideoPlaying(false); await tick(); o.sched.advance(3000)
  assert.equal(o.music.playing, false)
})

test('exit: dispose stops everything, leaves no timers, and later calls are inert', async () => {
  const o = setup(); await playing(o)
  o.c.celebrate(); o.sched.advance(REVEAL_DELAY_MS + 10); await tick(); o.sched.advance(2000)
  o.c.dispose()
  assert.equal(o.music.playing, false); assert.equal(o.applause!.playing, false); assert.equal(o.sched.pending, 0)
  const plays = o.music.plays
  await o.c.start(); o.c.celebrate(); o.c.setMusicEnabled(true); o.c.endCelebration(); await tick()
  assert.equal(o.music.plays, plays); assert.equal(o.sched.pending, 0)
})

// ---- which slides celebrate ----
const memory = { roundId: 'r1', roundOrdinal: 1, holeNumber: null, playerId: 'a', playerName: 'Alex Smith', capturedBy: 'a', capturedByName: 'Alex Smith', caption: null, imagePath: '', imageUrl: 'tiu-media://m1', audience: 'everyone', createdAt: '2026-10-24T10:00:00Z', organiserFavourite: true, sourceType: 'GENERAL' as const, sideCompId: null, sideCompName: null, sideCompType: null, mediaType: 'photo' as const, durationSeconds: null, isBlooper: false, aftershowIncluded: null }
const data: EventMemoryData = {
  event: { id: 't', name: 'Lappen', eventType: 'tournament', location: null, startDate: '2026-10-24', endDate: '2026-10-24', status: 'completed', groupPhotoMomentId: null, championPhotoMomentId: null },
  rounds: [{ id: 'r1', ordinal: 1, name: 'Round 1', courseName: 'Eagle Ridge', playDate: '2026-10-24', status: 'completed', holes: 18, publishedHighlights: null, winners: [{ playerId: 'a', playerName: 'Alex Smith', points: 40 }], standings: null, cumulativeStandings: null }],
  memories: [{ ...memory, momentId: 'm1' }], sideGameWinners: [], sideGameCount: 0, playerCount: 4,
  results: { champion: { champions: [{ playerId: 'a', playerName: 'Alex Smith', totalPoints: 40 }], hasTie: false, standings: [1, 2, 3, 4, 5].map(i => ({ playerId: `p${i}`, playerName: `Player ${i}`, totalPoints: 50 - i, position: i })) } },
}
test('only the Overall Champion slide celebrates: Top 5 (leaderboard), closing and every other slide kind never do', () => {
  const deck = buildPresentationDeck(data, defaultPresentationConfig(data, { kind: 'fullEvent' }))
  const kinds = deck.slides.map(s => s.kind)
  assert.ok(kinds.includes('champion') && kinds.includes('leaderboard') && kinds.includes('closing'))
  const celebrating = deck.slides.filter(s => isCelebrationSlide(s))
  assert.equal(celebrating.length, 1); assert.equal(celebrating[0].kind, 'champion')
  assert.equal(isCelebrationSlide(undefined), false)
  for (const k of ['leaderboard', 'closing', 'photo', 'roundResults', 'sideGameWinner', 'opening', 'blooper']) assert.equal(isCelebrationSlide({ kind: k }), false, k)
})
test('final sequence order: Overall Champion, then Top 5 Final Results, then Closing', () => {
  const kinds = buildPresentationDeck(data, defaultPresentationConfig(data, { kind: 'fullEvent' })).slides.map(s => s.kind)
  const c = kinds.indexOf('champion'), l = kinds.indexOf('leaderboard'), z = kinds.indexOf('closing')
  assert.ok(c >= 0 && c < l && l < z, kinds.join(','))
})

// ---- confetti ----
test('confetti: every piece has landed by the celebration length; reduced motion renders none', () => {
  for (const ms of [9000, 9430, 10000]) {
    const worst = buildConfettiPieces(ms, () => 0.999999)
    assert.ok(Math.max(...worst.map(p => p.delay + p.duration)) <= ms + 1, `ends within ${ms}`)
    assert.ok(Math.max(...worst.map(p => p.delay + p.duration)) >= ms - 400, 'builds and falls for the full length')
  }
  assert.equal(confettiPieces(9430, true).length, 0); assert.ok(confettiPieces(9430, false).length > 0)
})

// ---- asset / source guards ----
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
test('licensing guard: the unverified applause is NOT in public/ (not served), the feature flag defaults OFF, music file is present', () => {
  assert.equal(existsSync(fileURLToPath(new URL('../../../public/audio/celebration-applause.mp3', import.meta.url))), false)
  assert.equal(existsSync(fileURLToPath(new URL('../../../public/audio/funky-clubhouse-mix.mp3', import.meta.url))), true)
  const cfg = read('./audioConfig.ts')
  assert.ok(/NEXT_PUBLIC_PRESENTATION_APPLAUSE === 'on'/.test(cfg) && /: null/.test(cfg))
})
test('player wiring: celebration only via isCelebrationSlide; toggles in the hidden controls layer; no new effect reveals controls', () => {
  const src = read('../../components/memories/EventHighlightsPlayer.tsx')
  assert.equal((src.match(/celebrate\(\)/g) ?? []).length, 1, 'a single celebration trigger')
  assert.ok(/onChampionSlide = isCelebrationSlide\(current\)/.test(src))
  assert.ok(/audio\.confetti\.run > 0 && onChampionSlide/.test(src), 'confetti only on the champion slide')
  const controlsStart = src.indexOf('Controls -- fade during playback')
  assert.ok(src.slice(controlsStart).includes('audio.toggleMusic()') && !src.slice(0, controlsStart).includes('audio.toggleMusic()'))
  const effects = src.slice(src.indexOf('Video audio has priority'), src.indexOf('Keyboard controls'))
  assert.ok(!/bumpControls|setControlsVisible/.test(effects))
})
test('audio is served as static assets: no database/signed-URL code in the audio modules', () => {
  for (const f of ['./audioConfig.ts', './audioChannel.ts', './audioController.ts', '../../components/memories/usePresentationAudio.ts']) {
    assert.ok(!/supabase|signedUrl|createSignedUrl/i.test(read(f)), f)
  }
})
