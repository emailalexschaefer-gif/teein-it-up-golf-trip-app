'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { Slide } from '@/lib/trips/slideshowDeck'
import { isCelebrationSlide } from '@/lib/presentation/celebrationTrigger'
import PresentationConfetti from '@/components/memories/PresentationConfetti'
import { REVEAL_DELAY_MS, FALLBACK_CELEBRATION_MS } from '@/lib/presentation/audioConfig'
import { usePresentationAudio } from '@/components/memories/usePresentationAudio'
import { SlideMediaLoader, browserImageLoad, requiredImageUrl, withoutImage, urlsToPreload, contentReady, MEDIA_TIMEOUT_MS } from '@/lib/presentation/slideMedia'
import { moreTiedText } from '@/lib/trips/topFive'
import { showsMomentsCallout, snapshotTitleCqw, splitCourseName, pillarboxCqw, momentsLabelPlacement, momentsLabelHeading } from '@/lib/trips/presentationLayout'

/**
 * Event Memories V1.2 (12 Sep) -- the Event Highlights fullscreen
 * player. Extended V1.4 (14 Sep) for a 16:9 presentation canvas,
 * group photo/Bloopers slide rendering, video playback, and a
 * protected controls safe-area.
 *
 * 16:9 PRESENTATION CANVAS: the brief's own "separate the presentation
 * canvas from the device viewport" instruction. A fixed-aspect-ratio
 * canvas (width/height derived via the standard "fit an aspect ratio
 * inside a box" calculation, from the player's own box in container
 * units: min(100cqw, 100cqh*16/9) and min(100cqh, 100cqw*9/16)) is
 * centred within whatever the actual visible area is. On a TV/landscape device this canvas
 * fills (or nearly fills) the screen; on a portrait phone it
 * letterboxes with dark bars above/below -- deliberately, so the
 * story composition is always genuinely 16:9 regardless of the
 * controlling device, exactly as specified, rather than a stretched
 * mobile layout. Portrait phone controls remain fully usable: they
 * render below/around the canvas, not squeezed inside it.
 *
 * CONTROLS SAFE AREA: V1.3's real-device test showed bottom navigation
 * covering the bottom of a Makers & Breakers card. Fixed structurally,
 * not by nudging pixel values: every slide's own content now renders
 * inside a `contentSafeArea` region that reserves a fixed bottom strip
 * the controls live in -- slide content can never be laid out
 * underneath that strip at all, rather than relying on z-index/
 * careful positioning per slide type to avoid overlap.
 *
 * PRELOADING: only ever holds the current, next, and previous slide's
 * image in the DOM at once (three <img> elements, two of them
 * invisible/display:none) -- never eagerly loads the whole deck, per
 * the brief's explicit "do not eagerly fetch 100+ full-resolution
 * images simultaneously." A failed image shows a plain unavailable
 * state and playback continues; it never crashes the presentation.
 * Video (Bloopers) follows the same principle, extended for V1.4: only
 * the current slide's video element actually has a `src` attached
 * (next/previous Blooper slides render no `<video>` element at all
 * until they become current) -- never every Blooper clip loaded
 * eagerly when the presentation opens, per the brief's own explicit
 * "do not preload every video in an event."
 *
 * VIDEO PLAYBACK: a Blooper slide's own video duration (its real
 * `ended` event) drives advancement while autoplaying, not the fixed
 * photo-duration timer -- the fixed timer is used only as a fallback
 * if the video fails to load/play within a reasonable window, so a
 * clip is never cut short mid-playback by an unrelated timer, and
 * playback never silently stalls forever if a clip fails. Audio
 * follows the browser's own autoplay policy -- muted initially (the
 * only way autoplay is reliably permitted across mobile browsers), with
 * a tap-to-unmute control, rather than falsely claiming unmuted
 * autoplay works where it doesn't. Leaving a video slide (Previous/
 * Next/close) pauses and resets it; only the current slide's video can
 * ever be playing, by construction (the inactive slides render no
 * `<video>` element to play at all).
 *
 * FULLSCREEN: the player is a full-viewport overlay and does NOT request browser fullscreen
 * by itself (Android Chrome shows a grey instructional notice over the opening slide when it
 * does). An optional button requests it on the viewer's tap; refusal or no support changes nothing.
 *
 * WAKE LOCK: requested on Play, released on pause/exit, guarded
 * entirely behind a feature check and try/catch -- never a hard
 * dependency; its absence changes nothing else about playback.
 */

export interface EventHighlightsPlayerProps {
  slides: Slide[]
  durationSeconds: 5 | 8 | 10
  onExit: () => void
  // V1.18 (10 Oct), Package 5 -- when set, playback loops back to this
  // index (the Moments & Bloopers aftershow chapter's own start)
  // instead of stopping once it reaches the end of the deck. undefined
  // when the deck has no aftershow content, or aftershowLoop is false
  // -- playback then stops on the final slide exactly as before this
  // package (the closing screen, per the new ordering in slideshowDeck.ts).
  aftershowStartIndex?: number
  aftershowLoop?: boolean
}

// Must stay ABOVE the mobile TripBottomNav (z-index 100). The nav is rendered
// after the page content, so an equal z-index would paint it over the player's
// bottom controls on a phone (e.g. a small iPhone held in landscape).
const PLAYER_Z = 110
const CONTROLS_SAFE_AREA_PX = 96
// How long revealed controls stay up with no interaction.
const CONTROLS_IDLE_MS = 3500

// Real-device polish pass (10 Oct) -- Event-at-a-Glance legibility fix.
// Shared across all four statistic columns so the numeral and its
// label always get the identical treatment: a dark, soft text-shadow
// (reads as a glow/halo rather than a hard outline) plus a very thin
// dark stroke, applied as a CSSProperties object spread directly into
// each <p>'s own style. This is a pure CSS/text-rendering fix -- the
// approved artwork itself is untouched, and so is every live value it
// wraps (roundCount/totalHoles/sideGameCount/championCount all still
// come straight from `slide`, exactly as before).
const numeralShadow: React.CSSProperties = {
  textShadow: '0 2px 6px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9), 0 0 14px rgba(0,0,0,0.35)',
  WebkitTextStroke: '0.6px rgba(0,0,0,0.35)',
}
const labelShadow: React.CSSProperties = {
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
}

/** V1.17 (10 Oct) -- gold-only decorative icons for Event-at-a-Glance,
 * replacing platform emoji. A standard emoji (the flag/golfer/crown
 * glyphs used previously) renders in each device's own default
 * multi-colour style -- skin tones, a blue flag, etc. -- which is
 * exactly the "brightly coloured emoji that disrupts the presentation"
 * the brief asks to avoid. A simple inline SVG, filled entirely with
 * the presentation's own gold (#fbbf24), renders identically and
 * consistently gold on every device. */
function GoldFlagIcon({ size }: { size: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="2" width="2" height="20" rx="1" fill="#fbbf24" />
      <path d="M7 3.5L19 7L7 10.5V3.5Z" fill="#fbbf24" />
    </svg>
  )
}
function GoldClubsIcon({ size }: { size: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g transform="rotate(-20 12 12)">
        <rect x="11" y="2" width="2" height="19" rx="1" fill="#fbbf24" />
        <circle cx="12" cy="3" r="2.2" fill="#fbbf24" />
      </g>
      <g transform="rotate(20 12 12)">
        <rect x="11" y="2" width="2" height="19" rx="1" fill="#fbbf24" />
        <path d="M9.5 2.5L14.5 2.5L12 6.5Z" fill="#fbbf24" />
      </g>
    </svg>
  )
}
function GoldCrownIcon({ size }: { size: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 9L7 12L12 5L17 12L21 9L19.5 18H4.5L3 9Z" fill="#fbbf24" />
      <rect x="4.5" y="19" width="15" height="1.8" rx="0.9" fill="#fbbf24" />
    </svg>
  )
}

/** Quiet beat after the cheering ends before the next slide. */
const CHAMPION_TAIL_MS = 1200

export default function EventHighlightsPlayer({ slides, durationSeconds, onExit, aftershowStartIndex, aftershowLoop }: EventHighlightsPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  // 18 Oct field test: controls start HIDDEN and are shown only by a tap /
  // click / focus. A slide change never reveals them (see bumpControls).
  const [controlsVisible, setControlsVisible] = useState(false)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  // Presentation UX polish (12 Oct) -- the current photo/video's natural
  // size, keyed by momentId, so the "Relive it in My Golf" label can sit
  // in real pillarbox space (or fall back to a small corner pill) instead
  // of guessing. Nothing is rendered until the size is known.
  const [mediaSize, setMediaSize] = useState<{ key: string; w: number; h: number } | null>(null)
  const reportMediaSize = useCallback((key: string, w: number, h: number) => {
    if (w > 0 && h > 0) setMediaSize(prev => (prev && prev.key === key && prev.w === w && prev.h === h) ? prev : { key, w, h })
  }, [])
  // V1.18 (10 Oct), Package 5.2 -- "Audio = Muted" is the aftershow's
  // own explicit default setting (an ambient, background-slideshow
  // chapter playing while guests socialise, not a sudden burst of
  // sound) -- this supersedes the V1.6 "sound on by default" choice
  // documented below, which predates this brief and was written for
  // the old, narrower Bloopers chapter. Starts true (muted); the
  // unmute control below remains available for anyone who wants sound.
  // V1.6 (5 Oct) -- fixed a real UI/reality mismatch: video playback
  // (including audio) was already working correctly, but the mute
  // icon always showed muted regardless, since this started true and
  // the playback effect never attempted unmuted autoplay at all. The
  // effect below still only ever sets video.muted to match this state
  // (never claims a sound state that isn't what's actually playing).
  //
  // Real-device polish pass (10 Oct) -- back to `false` (sound ON by
  // default), superseding V1.18's own "Audio = Muted" default for
  // this same chapter. Direct real-device feedback: a Blooper's
  // dialogue is part of what makes it funny, so defaulting to silence
  // undercut the chapter's own point. The playback effect just below
  // already attempts unmuted autoplay first and only falls back to
  // muted (updating this state to match) if the browser's own
  // autoplay-with-sound restriction rejects it -- that fallback was
  // built in V1.6 and needed no change here; only the STARTING
  // assumption changes, from "assume blocked" to "assume allowed,
  // discover otherwise." The visible mute/unmute control is
  // unaffected either way.
  const [videoMuted, setVideoMuted] = useState(false)
  // V1.10 (6 Oct) -- Priority 6: true only if, after fullscreen and
  // orientation-lock were both attempted, the device is still
  // genuinely detectable as portrait. Dismissible; never blocks playback.
  const [showRotateHint, setShowRotateHint] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Background music + champion celebration (see lib/presentation/audioController.ts).
  const audio = usePresentationAudio()
  const { setVideoPlaying, celebrate, endCelebration } = audio
  const videoRef = useRef<HTMLVideoElement>(null)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const current = slides[index]
  const isPhoto = (s: Slide | undefined): s is Extract<Slide, { kind: 'photo' }> => s?.kind === 'photo'
  const isBlooper = (s: Slide | undefined): s is Extract<Slide, { kind: 'blooper' }> => s?.kind === 'blooper'
  // V1.6 (5 Oct) -- a Blooper can now be a photo as well as a video
  // (migration 090); only a VIDEO Blooper needs the video-specific
  // fallback timer described below. A photo Blooper behaves exactly
  // like an ordinary photo slide for timing purposes.
  const isVideoBlooper = (s: Slide | undefined): s is Extract<Slide, { kind: 'blooper' }> => isBlooper(s) && s.mediaType === 'video'

  // Package 1 correction -- media-ready playback (see lib/presentation/slideMedia.ts). A slide's
  // picture and its text are revealed together, only once the picture is loaded and decoded (or
  // has failed / timed out, in which case the slide's no-photo layout is used). The slide's
  // display timer and the champion celebration both start from that moment, never earlier.
  const [loader, setLoader] = useState<SlideMediaLoader | null>(null)
  const [, setMediaTick] = useState(0)
  useEffect(() => {
    const l = new SlideMediaLoader(browserImageLoad, () => setMediaTick(t => t + 1))
    setLoader(l)
    return () => { l.dispose(); setLoader(null) }
  }, [])
  const currentImageUrl = requiredImageUrl(current)
  useEffect(() => {
    if (!loader) return
    if (currentImageUrl) loader.request(currentImageUrl, true)
    for (const u of urlsToPreload(slides, index)) loader.request(u)
  }, [loader, slides, index, currentImageUrl])
  const mediaStatus = currentImageUrl && loader ? loader.statusOf(currentImageUrl) : null
  // Sensible timeout, counted from when the viewer actually reaches the slide.
  useEffect(() => {
    if (!loader || !currentImageUrl || mediaStatus !== 'loading') return
    const t = setTimeout(() => { console.warn('[presentation] photo timed out, showing fallback', { index }); loader.giveUp(currentImageUrl) }, MEDIA_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [loader, currentImageUrl, mediaStatus, index])
  const slideReady = contentReady(currentImageUrl, mediaStatus)
  // The slide as it should be drawn: its picture removed if that picture is unavailable.
  const shown: Slide | undefined = current && mediaStatus === 'failed' ? withoutImage(current) : current

  // Per-slide duration: photo slides use the chosen duration; title/
  // divider/closing slides stay visible a little longer. A video
  // Blooper slide's own timer is a FALLBACK only -- its real duration
  // comes from the video's own `ended` event (see the effect below);
  // this value is used if that event never fires (a failed/stalled
  // clip).
  const baseSlideMs = isVideoBlooper(current)
    ? ((current.durationSeconds ?? durationSeconds) + 3) * 1000
    : (current?.kind === 'photo' || (isBlooper(current) && current.mediaType === 'photo') ? durationSeconds : durationSeconds + 2) * 1000
  // The champion slide stays up for the whole celebration (reveal pause + applause/confetti + a
  // short beat), otherwise a 5-8 s slide would cut the cheering and confetti off part-way.
  const slideDurationMs = isCelebrationSlide(current)
    ? Math.max(baseSlideMs, REVEAL_DELAY_MS + FALLBACK_CELEBRATION_MS + CHAMPION_TAIL_MS)
    : baseSlideMs

  const goTo = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)))
  }, [slides.length])

  // V1.18 (10 Oct), Package 5.3 -- "when the final aftershow item
  // finishes, return to the first selected aftershow Moment and
  // continue indefinitely until the organiser exits or pauses... the
  // formal presentation plays once, the aftershow repeats." Looping
  // only ever applies once already inside the aftershow chapter
  // (index >= aftershowStartIndex) -- the formal presentation before
  // it, including the closing screen, never loops, by construction:
  // this is the only place `index` can ever jump backwards during
  // auto-advance, and it only fires once genuinely at the end of the
  // whole deck.
  const canLoopAftershow = aftershowLoop !== false && aftershowStartIndex !== undefined
  // V1.18 pre-deployment verification, item 4 -- the loop's landing
  // spot is the first actual Moment AFTER the "MOMENTS & BLOOPERS"
  // divider (aftershowStartIndex + 1), not the divider itself. The
  // divider is a chapter title card; it's meant to be seen once, on
  // the natural forward transition out of the closing screen, not
  // re-announced every time the ambient loop comes back around (which
  // would break the "background slideshow at a wedding" feel the
  // brief asks for). aftershowStartIndex + 1 is always a valid slide
  // index whenever aftershowStartIndex is set, because the divider is
  // only ever pushed when at least one aftershow Moment follows it
  // (see buildCoreSlides/buildPresentationDeck).
  const aftershowLoopTarget = aftershowStartIndex !== undefined ? aftershowStartIndex + 1 : undefined
  const advance = useCallback(() => {
    setIndex(prev => {
      if (prev < slides.length - 1) return prev + 1
      if (canLoopAftershow && aftershowStartIndex! <= prev) return aftershowLoopTarget!
      return prev
    })
  }, [slides.length, canLoopAftershow, aftershowStartIndex, aftershowLoopTarget])

  // Auto-advance (fallback timer for every slide, including the
  // aftershow). Stops on the last slide UNLESS the aftershow is about
  // to loop -- in that case advance() itself performs the loop-back,
  // so the timer must still fire.
  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (!playing || !slideReady) return // the viewing time starts when the slide is actually on screen
    const atEnd = index >= slides.length - 1
    const willLoop = atEnd && canLoopAftershow && aftershowStartIndex! <= index
    if (atEnd && !willLoop) { setPlaying(false); return }
    advanceTimer.current = setTimeout(advance, slideDurationMs)
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }
  }, [index, playing, slideReady, slideDurationMs, advance, slides.length, canLoopAftershow, aftershowStartIndex])

  // Video playback: play/pause follows the presentation's own state;
  // the video's real `ended` event advances immediately rather than
  // waiting for the fallback timer; leaving the slide resets playback
  // position so returning to it later starts from the beginning.
  useEffect(() => {
    const video = videoRef.current
    if (!isVideoBlooper(current) || !video) return
    if (playing) {
      // V1.6 (5 Oct) -- attempt unmuted playback first (sound on by
      // default, per the brief). Browsers that block unmuted autoplay
      // reject this promise; only then do we fall back to muted, and
      // critically, update React state to match -- the visible icon
      // must never claim a sound state that isn't what's actually
      // playing, in either direction.
      video.muted = videoMuted
      video.play().catch(() => {
        if (!video.muted) {
          video.muted = true
          setVideoMuted(true)
          video.play().catch(() => { /* still blocked -- manual tap-to-play remains available */ })
        }
      })
    } else {
      video.pause()
    }
    function onEnded() { advance() }
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('ended', onEnded)
      video.pause()
      video.currentTime = 0
    }
  }, [current, playing, advance, videoMuted])

  // V1.10 (6 Oct) -- Priority 6: landscape-first presentation.
  // Fullscreen + Wake Lock + orientation lock on mount; all released/
  // unlocked on unmount. Every API here is feature-checked and
  // wrapped in try/catch -- a rejection or missing API on any one of
  // them never blocks or breaks playback, and never retries in a loop
  // (each is attempted exactly once, on mount).
  //
  // Orientation locking is attempted AFTER fullscreen, not instead of
  // it -- most mobile browsers that support screen.orientation.lock()
  // at all only permit it while the document is actually in
  // fullscreen; requesting it first would just fail everywhere.
  // showRotateHint is the honest fallback the brief asks for: shown
  // only if, after both attempts, the device can still be detected as
  // portrait (matchMedia, itself widely supported and not dependent on
  // either API above) -- dismissible, and automatically cleared the
  // moment the device is actually rotated (the resize listener below),
  // never a blocking overlay that could strand playback.
  useEffect(() => {
    let cancelled = false

    // Package 1 (26 Oct) -- the presentation no longer requests browser fullscreen on its own.
    // Android Chrome answers every fullscreen request with its own grey "Viewing full screen /
    // swipe to exit" notice, drawn over the opening slide, which the page cannot hide or shorten.
    // The player is already a full-viewport overlay, so it opens clean; fullscreen is now an
    // optional button (toggleFullscreen) for viewers who want it.
    async function enterPresentationMode() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = (screen as any).orientation
      // Orientation can only be locked while fullscreen on mobile browsers; if the viewer has
      // already chosen fullscreen, keep landscape. Otherwise the rotate hint below covers portrait.
      if (document.fullscreenElement && orientation && typeof orientation.lock === 'function') {
        try { await orientation.lock('landscape') } catch { /* unsupported/rejected -- fall through to the portrait check below */ }
      }
      if (cancelled) return
      const stillPortrait = typeof window.matchMedia === 'function' && window.matchMedia('(orientation: portrait)').matches
      setShowRotateHint(stillPortrait)
    }
    enterPresentationMode()

    // If the hint is showing, clear it the moment the device is
    // actually rotated -- never left stale after the user acts on it.
    function onResize() {
      if (typeof window.matchMedia === 'function' && window.matchMedia('(orientation: landscape)').matches) setShowRotateHint(false)
    }
    window.addEventListener('resize', onResize)
    function onFullscreenChange() {
      const on = !!document.fullscreenElement
      setIsFullscreen(on)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = (screen as any).orientation
      if (on && orientation && typeof orientation.lock === 'function') orientation.lock('landscape').catch(() => {})
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)

    if ('wakeLock' in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock.request('screen')
        .then((lock: { release: () => Promise<void> }) => { wakeLockRef.current = lock })
        .catch(() => { /* wake lock unavailable/denied -- not a dependency */ })
    }
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = (screen as any).orientation
      if (orientation && typeof orientation.unlock === 'function') {
        try { orientation.unlock() } catch { /* nothing to unlock, or already unlocked -- harmless either way */ }
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      wakeLockRef.current?.release().catch(() => {})
    }
  }, [])

  // Optional fullscreen -- only ever in response to the viewer tapping the button.
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return }
      containerRef.current?.requestFullscreen?.().catch(() => { /* refused: the overlay is still full-viewport */ })
    } catch { /* not supported -- the button is only shown when it is */ }
  }

  // Controls are hidden when the presentation starts. A deliberate user
  // action (tap/click, or keyboard focus landing on a control) reveals them,
  // and they hide again after a short period of inactivity -- whether
  // playing or paused. Nothing else reveals them: in particular a slide
  // change (automatic or manual) and a play/pause toggle do NOT, because
  // visibility is deliberately independent of playback state and index.
  // (Root cause of the 18 Oct report: an effect re-ran bumpControls on every
  // change of `index`, so the controls reappeared on every slide.)
  const bumpControls = useCallback(() => {
    setControlsVisible(true)
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    hideControlsTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS)
  }, [])
  useEffect(() => () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) }, [])

  // Video audio has priority: while a Blooper video is playing with its sound on, the
  // soundtrack fades out and pauses; it resumes (same position) afterwards.
  const videoHasSound = isVideoBlooper(current) && playing && !videoMuted
  useEffect(() => {
    setVideoPlaying(videoHasSound)
    return () => setVideoPlaying(false)
  }, [videoHasSound, setVideoPlaying])

  // Overall Champion reveal: keyed on the slide INDEX only, so re-renders and incidental
  // state changes can never restart it; leaving the slide stops the applause and restores music.
  const onChampionSlide = isCelebrationSlide(current)
  useEffect(() => {
    if (!onChampionSlide || !slideReady) return // reveal first, then confetti/applause
    celebrate() // music fades to silence and stays off for this slide; applause + confetti start together after the reveal
    return () => { endCelebration() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChampionSlide, slideReady, index])

  // Keyboard controls (desktop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') { goTo(index + 1) }
      else if (e.key === 'ArrowLeft') { goTo(index - 1) }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'Escape') { onExit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, goTo, onExit])

  function renderPhoto(slide: Extract<Slide, { kind: 'photo' }> | undefined, visible: boolean) {
    if (!slide) return null
    // Package 1 -- a photo whose file could not be found (no URL) used to be a silent blank
    // frame. It now says so, and the Moment id is logged so the file can be traced.
    if (!slide.imageUrl) {
      return (
        <div key={slide.momentId} style={{ position: 'absolute', inset: 0, display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Photo unavailable</p>
        </div>
      )
    }
    const failed = failedUrls.has(slide.imageUrl)
    return (
      <div key={slide.momentId} style={{ position: 'absolute', inset: 0, display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
        {failed ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Photo unavailable</p>
        ) : (
          <>
            {/* Blurred, darkened backdrop of the same image -- fills the
                frame behind any photo whose aspect ratio doesn't match the
                16:9 canvas (portrait photos, in particular), replacing
                large flat black bars without cropping the actual photo
                (which stays full-contain in the foreground below). No
                extra permanent file is created -- this is the same
                already-loaded image, rendered twice via CSS. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.imageUrl} alt="" aria-hidden style={{ position: 'absolute', inset: -20, width: 'calc(100% + 40px)', height: 'calc(100% + 40px)', objectFit: 'cover', filter: 'blur(28px) brightness(0.5)', transform: 'scale(1.1)' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.imageUrl} alt={slide.caption ?? 'Event memory'}
              style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              // 27 Oct: an image that finished loading before this handler existed (cache / preload) never fires onLoad again,
              // which would silently drop the Moments callout for that photo. Report the size from the ref too.
              ref={visible ? (el) => { if (el && el.complete && el.naturalWidth > 0) reportMediaSize(slide.momentId, el.naturalWidth, el.naturalHeight) } : undefined}
              onLoad={visible ? (e) => reportMediaSize(slide.momentId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) : undefined}
              onError={() => { console.warn('[presentation] photo failed to load', { momentId: slide.momentId }); setFailedUrls(prev => new Set(prev).add(slide.imageUrl!)) }}
            />
          </>
        )}
      </div>
    )
  }

  const current16x9Photo = isPhoto(shown) ? shown : undefined

  return (
    <div
      ref={containerRef}
      onClickCapture={audio.unlock}
      onClick={bumpControls}
      onTouchStart={bumpControls}
      style={{ position: 'fixed', inset: 0, background: '#000', zIndex: PLAYER_Z, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', containerType: 'size' }}
    >
      {/* V1.18 (10 Oct), Package 5.2 -- the aftershow's "gentle fade"
          transition keyframe, defined once here rather than per-slide. */}
      <style>{'@keyframes ttuAftershowFade { from { opacity: 0 } to { opacity: 1 } } @keyframes ttuLoadIn { from { opacity: 0 } to { opacity: 1 } } @keyframes ttuSpin { to { transform: rotate(360deg) } } @media (prefers-reduced-motion: reduce) { .ttu-loading { animation: ttuLoadIn 0.4s ease 0.45s both !important } }'}</style>
      {/* 16:9 presentation canvas -- letterboxes on a portrait device,
          fills on landscape/TV. Everything slide-related renders
          inside this fixed-ratio box, never directly against the raw
          device viewport. */}
      <div style={{
        position: 'relative', background: '#000', overflow: 'hidden',
        // Sized from the player's own (visible) box, not the viewport: without browser fullscreen
        // the address bar is showing and the viewport height would be taller than the screen the viewer can see.
        width: 'min(100cqw, calc(100cqh * 16 / 9))',
        height: 'min(100cqh, calc(100cqw * 9 / 16))',
        // Presentation UX polish (12 Oct) -- makes this canvas a size
        // container so slides can size type in `cqw` (1% of the CANVAS
        // width) instead of `vw` (1% of the device viewport). On a
        // letterboxed phone the two differ a lot, which is why vw-sized
        // Event Snapshot text overflowed the slide in real testing.
        containerType: 'inline-size',
      }}>
        {/* Preload current + adjacent photo slides only -- never the whole deck. */}
        {renderPhoto(isPhoto(slides[index - 1]) ? slides[index - 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}
        {slideReady && renderPhoto(current16x9Photo, true)}
        {renderPhoto(isPhoto(slides[index + 1]) ? slides[index + 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}

        {!slideReady && (
          <div role="status" aria-live="polite" aria-label="Loading" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
            <span className="ttu-loading" style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.18)', borderTopColor: '#c9a84c', animation: 'ttuLoadIn 0.4s ease 0.45s both, ttuSpin 0.9s linear infinite' }} />
          </div>
        )}

        {slideReady && !isPhoto(current) && (
          <NonPhotoSlide
            slide={shown!}
            videoRef={videoRef}
            videoMuted={videoMuted}
            onVideoFailed={() => advance()}
            onMediaSize={reportMediaSize}
          />
        )}

        {/* Photo context overlay -- subtle, never competing with the
            photograph, and kept clear of the controls safe-area strip. */}
        {slideReady && isPhoto(current) && (current.roundName || current.holeNumber || current.playerName || current.sideCompName || current.caption) && (
          <div data-testid="photo-caption" style={{ position: 'absolute', left: 0, right: 0, bottom: CONTROLS_SAFE_AREA_PX, padding: `${sz(22, 3.4, 90)} ${sz(20, 4, 100)} ${sz(14, 1.8, 40)}`, background: 'linear-gradient(to top, rgba(0,0,0,0.84) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0))', pointerEvents: 'none' }}>
            {current.playerName && (
              <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(20, 3.1, 64), fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: sz(2, 0.3, 8), maxWidth: '88%', overflowWrap: 'anywhere', textShadow: '0 1px 6px rgba(0,0,0,0.85)' }}>{current.playerName}</p>
            )}
            {current.sideCompName && (
              <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(16, 2.3, 48), fontWeight: 700, color: '#fbbf24', lineHeight: 1.15, marginBottom: sz(2, 0.3, 8), textShadow: '0 1px 5px rgba(0,0,0,0.85)' }}>{current.sideCompName}</p>
            )}
            {(current.roundName || current.holeNumber) && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.7, 36), fontWeight: 700, letterSpacing: '0.08em', color: '#f3e7c4', textTransform: 'uppercase', textShadow: '0 1px 4px rgba(0,0,0,0.85)' }}>
                {[current.roundName, current.holeNumber ? `Hole ${current.holeNumber}` : null].filter(Boolean).join(' \u00b7 ')}
              </p>
            )}
            {current.caption && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(14, 1.9, 40), lineHeight: 1.3, color: '#f3f4f6', marginTop: sz(3, 0.6, 14), maxWidth: '72%', overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4, overflow: 'hidden', textShadow: '0 1px 4px rgba(0,0,0,0.85)' }}>{current.caption}</p>
            )}
          </div>
        )}

        {/* "Relive it in My Golf -> Moments" source label -- photo Moments
            and Blooper photos/videos only (never group photo, winner,
            champion or any other slide: rule in showsMomentsCallout()). Drawn AFTER the
            caption gradient so the gradient never dims it; below the controls layer; never intercepts a tap. */}
        {slideReady && showsMomentsCallout(current.kind) && mediaSize && mediaSize.key === current.momentId && (
          <MomentsSourceLabel
            heading={momentsLabelHeading(isBlooper(current) ? current.isBlooper : undefined)}
            aspect={mediaSize.w / mediaSize.h}
          />
        )}

        {audio.confetti.run > 0 && onChampionSlide && <PresentationConfetti key={audio.confetti.run} durationMs={audio.confetti.ms} />}

        {/* Mute/unmute, Blooper slides only. */}
        {isVideoBlooper(current) && (
          <button
            onClick={(e) => { e.stopPropagation(); setVideoMuted(m => !m) }}
            style={{ position: 'absolute', bottom: CONTROLS_SAFE_AREA_PX + 12, right: 16, width: 36, height: 36, borderRadius: 18, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 15, cursor: 'pointer' }}
          >
            {videoMuted ? '\u{1F507}' : '\u{1F50A}'}
          </button>
        )}

        {/* V1.10 (6 Oct) -- Priority 6's explicit fallback: shown only
            when the device is still genuinely portrait after both
            fullscreen and orientation-lock were attempted and either
            failed or aren't supported. Dismissible (never blocks
            playback), and auto-clears the moment the device is
            actually rotated (see the resize listener in the effect
            above). Sits above the controls safe area, never inside it. */}
        {showRotateHint && (
          <div style={{ position: 'absolute', top: 12, left: 12, right: 60, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'rgba(0,0,0,0.72)', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#fff', margin: 0 }}>Rotate your phone to landscape for the best presentation.</p>
            <button onClick={(e) => { e.stopPropagation(); setShowRotateHint(false) }} style={{ flexShrink: 0, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, width: 22, height: 22, fontSize: 12, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Controls -- fade during playback, reappear on interaction.
            Occupy exactly the reserved CONTROLS_SAFE_AREA_PX strip, so
            no slide content can ever render underneath them. */}
        <div onFocusCapture={bumpControls} style={{ position: 'absolute', inset: 0, opacity: controlsVisible ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: controlsVisible ? 'auto' : 'none' }}>
          <button onClick={onExit} style={{ position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
            ✕
          </button>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: CONTROLS_SAFE_AREA_PX, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
            <button onClick={() => goTo(index - 1)} disabled={index === 0} style={navButtonStyle(index === 0)}>‹</button>
            <button onClick={() => setPlaying(p => !p)} style={playButtonStyle}>{playing ? '⏸' : '▶'}</button>
            {/* V1.18 (10 Oct), Package 5.4 -- "Next Moment" stays usable
                at the very end of the aftershow by manually looping back
                to its start too, matching what auto-advance already
                does -- never disabled merely because the deck array
                itself has ended when the aftershow is still playable. */}
            <button
              onClick={() => goTo(index === slides.length - 1 && canLoopAftershow && aftershowStartIndex! <= index ? aftershowLoopTarget! : index + 1)}
              disabled={index === slides.length - 1 && !(canLoopAftershow && aftershowStartIndex! <= index)}
              style={navButtonStyle(index === slides.length - 1 && !(canLoopAftershow && aftershowStartIndex! <= index))}
            >›</button>
            {/* Soundtrack and celebration-sound toggles -- inside the controls layer, so they
                are hidden until the viewer interacts, like every other control. */}
            <button
              onClick={(e) => { e.stopPropagation(); audio.toggleMusic() }}
              aria-pressed={audio.state.musicEnabled}
              aria-label={audio.state.musicEnabled ? 'Turn music off' : 'Turn music on'}
              title={audio.state.blocked && audio.state.musicEnabled ? 'Tap to start music' : undefined}
              style={{ ...navButtonStyle(false), fontSize: 16, opacity: audio.state.musicEnabled ? 1 : 0.55 }}
            ><span style={{ textDecoration: audio.state.musicEnabled ? 'none' : 'line-through' }}>{'\u266A'}</span></button>
            {audio.state.applauseAvailable && (
              <button
                onClick={(e) => { e.stopPropagation(); audio.toggleApplause() }}
                aria-pressed={audio.state.applauseEnabled}
                aria-label={audio.state.applauseEnabled ? 'Turn celebration sound off' : 'Turn celebration sound on'}
                title={audio.state.applauseEnabled ? 'Applause on winner slides: ON (tap to turn off)' : 'Applause on winner slides: OFF (tap to turn on)'}
                style={{ ...navButtonStyle(false), fontSize: 16, opacity: audio.state.applauseEnabled ? 1 : 0.55 }}
              >{'\u{1F44F}'}</button>
            )}
            {canFullscreen && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                style={{ ...navButtonStyle(false), fontSize: 16 }}
              >{isFullscreen ? '\u2922' : '\u26F6'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * PresentationPhoto -- V1.7 (6 Oct) regression fix. One shared,
 * 16:9-safe photo treatment, reused by Side Game Winner, Round
 * Winner, and Event Champion -- previously each of those three slides
 * used a plain `background: url(...) center/cover`, which crops/zooms
 * a portrait or odd-aspect photo to fill the frame, cutting off
 * subjects (confirmed directly as the root cause from a real device
 * test -- the Event Champion's head being cropped out of frame was
 * the most visible symptom). This reuses the exact same blurred-
 * backdrop-plus-contained-foreground pattern the ordinary photo slide
 * (renderPhoto, above) already gets right: the full, uncropped image
 * always stays visible in the foreground; a blurred, darkened copy of
 * the same image fills the frame behind it, replacing flat bars
 * without ever cropping the actual subject. A landscape photo that
 * already fills a 16:9 frame naturally shows little to no visible
 * backdrop, exactly as intended -- this is one treatment that adapts
 * to any source aspect ratio, not a special case for portrait photos.
 * Building this once and reusing it in three places means a future
 * fix to this treatment only has to happen once, not be chased down
 * separately in three renderers again.
 */
/**
 * GenericTemplateSlide -- V1.11 (7 Oct). The approved universal
 * background for generic slides (public/images/generic-slide-
 * template.jpg), used exactly as supplied: no dynamically-added
 * logo, border, golf ball, or watermark, since the artwork already
 * contains all of that. Content is laid out only inside the
 * deliberately clear central area the artwork leaves open -- this
 * component reserves generous top/bottom/side padding specifically
 * to keep dynamic text away from the artwork's own border and bottom-
 * right branding, never overlapping either. One shared component so
 * every generic slide (Makers & Breakers, round dividers, the Bloopers
 * divider, and the no-photo fallback for Side Game Winner/Round
 * Winner) automatically inherits the same visual language and the
 * same safe-area guarantees, rather than this being reimplemented per
 * slide kind.
 */
function GenericTemplateSlide({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: 'url(/images/generic-slide-template.jpg)', backgroundSize: 'cover', backgroundPosition: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'clamp(28px, 6vh, 64px) clamp(60px, 9vw, 130px)',
    }}>
      {children}
    </div>
  )
}

/**
 * Stage-scaled type (27 Oct). Sizes follow the 16:9 STAGE width (cqw = 1% of the canvas, see the containerType on the stage),
 * never the user agent or the raw viewport, with a floor so a phone in landscape stays legible and a ceiling so a 4K TV
 * doesn't produce absurd glyphs. clamp(min px, cqw, max px).
 */
const sz = (min: number, cqw: number, max: number) => `clamp(${min}px, ${cqw}cqw, ${max}px)`

function PresentationPhoto({ imageUrl, overlay, children }: { imageUrl: string | null; overlay?: 'dark'; children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden' }}>
      {imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" aria-hidden style={{ position: 'absolute', inset: -20, width: 'calc(100% + 40px)', height: 'calc(100% + 40px)', objectFit: 'cover', filter: 'blur(28px) brightness(0.45)', transform: 'scale(1.1)' }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" style={{ position: 'absolute', inset: 0, margin: 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </>
      )}
      {overlay === 'dark' && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(10,10,10,0.1) 0%, rgba(10,10,10,0.75) 72%, rgba(10,10,10,0.92) 100%)' }} />
      )}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}

function NonPhotoSlide({ slide, videoRef, videoMuted, onVideoFailed, onMediaSize }: {
  slide: Slide
  videoRef: React.RefObject<HTMLVideoElement | null>
  videoMuted: boolean
  onVideoFailed: () => void
  onMediaSize?: (momentId: string, w: number, h: number) => void
}) {
  if (slide.kind === 'opening') {
    // V1.4 completion patch (14 Sep) -- the supplied 16:9 golf-course
    // artwork (public/images/event-highlights-opening.jpg; the
    // corrected version, with no Teein' It Up logo printed on the
    // foreground golf ball, and the artwork's own bottom-right
    // "Event Highlights / Powered by / Teein' It Up" branding already
    // baked in) replaces the prior gradient placeholder. Event name/
    // dates are overlaid dynamically here, never baked into the image
    // itself -- the same static asset serves every event. Positioned
    // upper-left, over open sky, specifically so it never collides
    // with the artwork's own bottom-right branding strip or the
    // foreground golf ball -- confirmed by inspecting the actual
    // supplied image before choosing this placement, not guessed at.
    // "Event Highlights" as a standalone label and a separate
    // "Powered by" line were both removed from this overlay -- the
    // artwork's own branding already states both, and repeating them
    // here would be redundant on top of the real image.
    return (
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'url(/images/event-highlights-opening.jpg)',
        backgroundSize: 'cover', backgroundPosition: 'center',
      }}>
        {/* V1.5 (15 Sep) -- fixed a real contrast bug found in live
            testing against the bright sunrise-sky artwork: the
            previous overlay (55% opacity, fully transparent by 65%
            down) wasn't dark enough, and the date text in particular
            could land directly on bright sky with no protection at
            all. Two independent fixes layered together rather than
            relying on either alone: the gradient itself is both
            darker (75% at the very top) and extends further down
            before fading out, AND every piece of text here also
            carries its own text-shadow -- a pixel-independent safety
            net that keeps the text legible even directly against a
            bright, complex part of the image the gradient alone
            might not sufficiently darken at every point. */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '7% 6% 0', background: 'linear-gradient(rgba(4,12,8,0.75) 0%, rgba(4,12,8,0.35) 55%, rgba(4,12,8,0) 85%)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 4vw, 38px)', fontWeight: 800, color: '#fff', marginBottom: 6, letterSpacing: 0.5, maxWidth: '70%', lineHeight: 1.15, textShadow: '0 2px 10px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)' }}>{slide.eventName}</p>
          {/* Final pre-production gate follow-up / Phase E (11 Oct) --
              date visibility fix. Previously clamp(12px,1.5vw,16px) at
              a pale cream (#f0e6d2) -- legible against a dark lower
              sky but easy to miss against a bright sunrise, and small
              enough to read as an afterthought beneath the event
              title. Reuses formatDateRange()'s own output verbatim
              (slide.dateRange) -- no new date formatting logic, only
              this renderer's own size/colour/weight. Event title above
              is completely unchanged -- still the visually dominant
              element on this slide. */}
          {slide.dateRange && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(15px, 2.1vw, 21px)', fontWeight: 700, color: '#ffffff', letterSpacing: 0.6, textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.95)' }}>{slide.dateRange}</p>}
        </div>
      </div>
    )
  }
  if (slide.kind === 'eventAtAGlance') {
    // Phase E (11 Oct) verification pass -- corrected per the user's
    // review. The approved photographic composition (sunset, water,
    // golf ball, gold dividers, bottom-right branding) is now the real
    // background image (event-at-a-glance-bg-v2.jpg), supplied clean --
    // no event name, heading or stats baked in, confirmed by direct
    // visual inspection before wiring it in. Only the genuinely dynamic
    // content (the "EVENT SNAPSHOT" heading's event name, and the four
    // live stat columns) is real DOM text layered on top; the divider
    // lines, logo and tagline are part of the artwork itself, not
    // redrawn in CSS. The earlier CSS-gradient version (Option B,
    // adopted because the background asset on hand at the time had a
    // mismatched baked heading) is gone.
    //
    // Stat-column x-positions are measured directly from this specific
    // image's own baked divider lines (35.89% / 50.51% / 64.95%, pixel-
    // sampled from the supplied artwork), not reused from the prior
    // artwork's different proportions.
    //
    // Icons are gold-only inline SVGs (GoldFlagIcon/GoldClubsIcon/
    // GoldCrownIcon, defined above), not emoji -- avoids each device's
    // own multi-colour default emoji rendering, per the explicit
    // "avoid brightly coloured emojis" requirement, unchanged from
    // before.
    //
    // Every number and name below is a live value from `slide`'s own
    // fields, computed from real event data -- nothing here is
    // rasterized, and the Event Champion column correctly reflects a
    // tie (2+) or no confirmed champion yet (0), never hardcoded to 1
    // (slideshowDeck.ts's championCount, sourced from the same
    // authoritative champions array the Champion slide itself uses).
    // No date is shown anywhere on this slide, per the approved brief.
    // Presentation UX polish (12 Oct) -- layout rebuilt as ONE 16:9
    // composition sized in `cqw` (1% of the canvas width), designed
    // against the approved 1672x941 reference, instead of independent
    // vw-clamped elements. Real Samsung testing showed vw-sized text
    // overflowing the letterboxed canvas: the long title wrapped to two
    // huge lines, crowding the stats, and the Rounds column (centred at
    // 18% of width, over the golf ball) put the course names on top of
    // the ball. Columns now sit where the reference puts them: Rounds
    // 19-35.89% (clear of the ball, which ends ~18%), then the three
    // columns bounded by the artwork's own measured dividers.
    // Reference title is ~5.2cqw for a ~22-character name; longer names
    // scale down proportionally (see snapshotTitleCqw).
    const titleCqw = snapshotTitleCqw(slide.eventName)
    const courseCqw = slide.courseNames.length > 4 ? 1.3 : 1.6
    const ICON = '2.5cqw'
    const statCols: { left: number; width: number; value: number; label: React.ReactNode; icon: React.ReactNode; courses?: boolean }[] = [
      { left: 19, width: 16.89, value: slide.roundCount, label: `Round${slide.roundCount === 1 ? '' : 's'}`, icon: <GoldFlagIcon size={ICON} />, courses: true },
      { left: 35.89, width: 14.62, value: slide.totalHoles, label: `Hole${slide.totalHoles === 1 ? '' : 's'}`, icon: <GoldFlagIcon size={ICON} /> },
      { left: 50.51, width: 14.44, value: slide.sideGameCount, label: `Side Game${slide.sideGameCount === 1 ? '' : 's'}`, icon: <GoldClubsIcon size={ICON} /> },
      // Live championCount -- never hardcoded; correctly shows 0 (no
      // confirmed champion yet) or 2+ (a genuine tie).
      // No champion declared (event ended early): no crown and no champion claim -- the
      // artwork's fourth column shows the number of players instead.
      slide.championDeclared === false
        ? { left: 64.95, width: 16.65, value: slide.playerCount ?? 0, label: `Player${slide.playerCount === 1 ? '' : 's'}`, icon: <GoldFlagIcon size={ICON} /> }
        : { left: 64.95, width: 16.65, value: slide.championCount, label: 'Event Champion', icon: <GoldCrownIcon size={ICON} /> },
    ]
    const ruleStyle = (dir: 'l' | 'r'): React.CSSProperties => ({ flex: '0 0 16cqw', height: 1, background: `linear-gradient(to ${dir === 'l' ? 'right' : 'left'}, transparent, #e8c96a)` })
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the approved photographic background; decorative, all real content is the DOM text below */}
        <img
          src="/images/event-at-a-glance-bg-v2.jpg"
          alt=""
          aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Title block -- the event's own (dynamic) name, then the
            mandatory "EVENT SNAPSHOT" heading directly beneath it. No
            logo here: it is part of the artwork, bottom-right. */}
        <div style={{ position: 'absolute', left: '6%', right: '6%', top: '5.5%', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: `${titleCqw}cqw`, fontWeight: 800, color: '#fff', lineHeight: 1.08, letterSpacing: '0.01em', overflowWrap: 'anywhere', textShadow: '0 0.2cqw 1cqw rgba(0,0,0,0.65), 0 0.05cqw 0.2cqw rgba(0,0,0,0.9)' }}>{slide.eventName}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.6cqw', marginTop: '0.9cqw' }}>
            <span style={ruleStyle('l')} />
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '2cqw', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.32em', paddingLeft: '0.32em', whiteSpace: 'nowrap', textShadow: '0 0.1cqw 0.6cqw rgba(0,0,0,0.7)' }}>EVENT SNAPSHOT</p>
            <span style={ruleStyle('r')} />
          </div>
        </div>

        {/* Statistics -- four equally prominent columns on one row, each
            positioned against the artwork's own baked divider lines
            (35.89% / 50.51% / 64.95%). */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '29.5%' }}>
          {statCols.map(col => (
            <div key={col.left} style={{ position: 'absolute', top: 0, left: `${col.left}%`, width: `${col.width}%`, textAlign: 'center', minWidth: 0 }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '4.9cqw', fontWeight: 800, color: '#fff', lineHeight: 1, ...numeralShadow }}>{col.value}</p>
              <div style={{ marginTop: '0.6cqw', display: 'flex', justifyContent: 'center' }}>{col.icon}</div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.45cqw', letterSpacing: '0.07em', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, marginTop: '0.5cqw', whiteSpace: 'nowrap', ...labelShadow }}>{col.label}</p>
              {col.courses && slide.courseNames.length > 0 && (
                // Wider than the column on purpose (the reference lets
                // the longest line run past the divider's lower end) and
                // left-aligned from just right of the golf ball, with
                // "Club — Course" split onto two lines as in the
                // reference so long names never need to wrap mid-name.
                <div style={{ marginTop: '1.3cqw', marginLeft: '1.9cqw', width: '23cqw', textAlign: 'left' }}>
                  {slide.courseNames.map((name, i) => {
                    const { club, course } = splitCourseName(name)
                    return (
                      <p key={i} style={{ fontFamily: 'var(--font-display)', fontSize: `${courseCqw}cqw`, fontWeight: 500, color: '#f3f4f6', lineHeight: 1.25, overflowWrap: 'anywhere', marginTop: i === 0 ? 0 : '0.8cqw', textShadow: '0 0.1cqw 0.5cqw rgba(0,0,0,0.95), 0 0 0.2cqw rgba(0,0,0,0.9)' }}>
                        {club}
                        {course !== null && (<><br />{course}</>)}
                      </p>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (slide.kind === 'groupPhoto') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        {slide.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slide.imageUrl} alt={slide.caption ?? 'Group photo'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : null}
      </div>
    )
  }
  if (slide.kind === 'eventDivider') {
    return (
      <GenericTemplateSlide>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: '#fff', letterSpacing: 2 }}>EVENT MEMORIES</p>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'roundDivider') {
    return (
      <GenericTemplateSlide>
        {/* V1.14 (8 Oct) -- typography increased ~40-50% per explicit
            real-device sizing feedback (round name and course name),
            date increased more moderately while remaining visually
            tertiary. Background artwork untouched. */}
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(29px, 4.9vw, 44px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 14, textAlign: 'center' }}>{slide.roundName}</p>
        {slide.courseName && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(16px, 2.6vw, 22px)', color: '#e5e7eb', textAlign: 'center' }}>{slide.courseName}</p>}
        {slide.playDate && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(13px, 1.7vw, 15px)', color: '#d1d5db', marginTop: 4, textAlign: 'center' }}>{new Date(slide.playDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'sideGameWinner') {
    // Competition/result-first treatment -- distinct from an ordinary
    // photo slide, so a Side Game Memory is never confused with the
    // official winner announcement. No-photo fallback substantially
    // improved for V1.4: a proper gold-accented winner card with real
    // visual hierarchy, rather than plain centred text on flat green.
    const compLine = `${slide.label}${slide.holeNumber ? ` \u00b7 Hole ${slide.holeNumber}` : ''}`
    return slide.winnerImageUrl ? (
      <PresentationPhoto imageUrl={slide.winnerImageUrl} overlay="dark">
        <div data-testid="sidegame-winner" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: `${sz(40, 8, 150)} ${sz(20, 4, 100)} ${sz(56, 6, 130)}`, textAlign: 'center', background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0))' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(15, 2.2, 48), fontWeight: 800, letterSpacing: '0.14em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: sz(6, 0.9, 20), textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{compLine}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(28, 5.6, 110), fontWeight: 800, color: '#fff', textTransform: 'uppercase', lineHeight: 1.05, marginBottom: sz(5, 0.8, 18), maxWidth: '92%', overflowWrap: 'anywhere', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.7, 36), color: '#f3f4f6', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, textShadow: '0 1px 5px rgba(0,0,0,0.9)' }}>Winner</p>
        </div>
      </PresentationPhoto>
    ) : (
      <GenericTemplateSlide>
        <div data-testid="sidegame-winner" style={{ border: '1.5px solid rgba(251,191,36,0.5)', borderRadius: sz(14, 1.6, 36), padding: `${sz(24, 3.4, 80)} ${sz(28, 4.4, 110)}`, textAlign: 'center', background: 'rgba(0,0,0,0.15)', maxWidth: '88%' }}>
          <p style={{ fontSize: sz(34, 6, 120), marginBottom: sz(8, 1.2, 28), lineHeight: 1 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(14, 2.1, 46), fontWeight: 800, letterSpacing: '0.14em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: sz(8, 1.2, 28) }}>{compLine}</p>
          <div style={{ width: sz(36, 5, 120), height: 2, background: '#fbbf24', margin: `0 auto ${sz(10, 1.6, 36)}` }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(26, 5.2, 104), fontWeight: 800, color: '#fff', textTransform: 'uppercase', lineHeight: 1.05, marginBottom: sz(6, 1, 22), overflowWrap: 'anywhere' }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.7, 36), color: '#d9c9a3', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>Winner</p>
        </div>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'makersBreakersDivider') {
    // V1.15 (9 Oct) -- reworded per the approved closing-slideshow
    // brief, item 3: these are earned badges, not just a section
    // label, and the slide should make that explicit plus point back
    // to MyGolf (the same "revisit MyGolf" journey the closing slide
    // itself reinforces) -- a subtle one-line reference here, not a
    // promotional call-to-action.
    return (
      <GenericTemplateSlide>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(14, 1.9, 40), letterSpacing: '0.16em', color: '#d9c9a3', textTransform: 'uppercase', marginBottom: sz(8, 1.2, 28) }}>{slide.roundName}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(28, 5.2, 104), fontWeight: 800, color: '#fff', letterSpacing: 1, textAlign: 'center', lineHeight: 1.1 }}>Makers &amp; Breakers Badges</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.8, 38), color: '#d1d5db', marginTop: sz(8, 1.4, 30) }}>Your badges live in MyGolf.</p>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'makersBreakersCard') {
    // V1.7 (6 Oct) -- photo matching removed entirely, per an explicit
    // product correction from live testing: a generic group photo
    // being shown as "The Mailman"'s own photo demonstrated that the
    // approximate, display-name-only matching actively weakened the
    // story rather than helping it. This is the generated story, not
    // a photo lookup -- every card now always uses the standard
    // premium background treatment, with strong typography, never a
    // photo.
    const { highlight: h } = slide
    const accentColor = h.kind === 'maker' ? '#eab308' : '#ef4444'
    // V1.14 (8 Oct) -- Priority 3: identify who actually earned the
    // award. A group highlight (h.roster present and non-empty) now
    // shows the full list of player names belonging to that group,
    // not just the group's own name -- the audience should never have
    // to guess who earned it. An individual highlight (no roster)
    // shows h.playerName exactly as before -- unchanged. Visual
    // identity (gold/red accent, icon, title, description, generic
    // template background) is entirely preserved; only the identity
    // line beneath the title changes. Long rosters get a smaller font
    // and wrap naturally (whiteSpace is left at its default, not
    // nowrap) rather than ever overflowing the card.
    const roster = h.roster && h.roster.length > 0 ? h.roster.map(m => m.playerName).join(' \u2022 ') : null
    const rosterIsLong = (roster?.length ?? 0) > 60
    return (
      <GenericTemplateSlide>
        <div data-testid="mb-card" style={{ border: `${sz(2, 0.25, 5)} solid ${accentColor}88`, borderRadius: sz(16, 2, 44), padding: `${sz(18, 2.6, 64)} ${sz(24, 4, 100)}`, textAlign: 'center', background: `linear-gradient(160deg, ${accentColor}2e, ${accentColor}0d)`, width: 'min(78cqw, 1500px)', maxHeight: '100%', boxSizing: 'border-box', overflow: 'hidden', boxShadow: `0 0 ${sz(20, 4, 100)} ${accentColor}22` }}>
          <p style={{ fontSize: sz(48, 9, 190), lineHeight: 1, marginBottom: sz(6, 1, 26) }}>{h.icon}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.7, 38), fontWeight: 800, letterSpacing: '0.2em', color: accentColor, textTransform: 'uppercase', marginBottom: sz(4, 0.7, 18) }}>{h.kind === 'maker' ? 'Maker' : 'Breaker'}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(26, 5.4, 108), fontWeight: 800, color: '#fff', lineHeight: 1.08, marginBottom: sz(6, 1.2, 28), overflowWrap: 'anywhere' }}>{h.title}</p>
          {roster ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: rosterIsLong ? sz(13, 2.0, 44) : sz(17, 3.2, 70), fontWeight: 700, color: '#fff', marginBottom: sz(3, 0.6, 14), lineHeight: 1.3, overflowWrap: 'anywhere' }}>{roster}</p>
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(18, 3.6, 76), fontWeight: 700, color: '#fff', marginBottom: sz(3, 0.6, 14), lineHeight: 1.15, overflowWrap: 'anywhere' }}>{h.playerName}</p>
          )}
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(14, 2.2, 48), color: '#e5e7eb', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{h.statLine}</p>
        </div>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'champion') {
    // V1.7 (6 Oct) -- fixed a serious, reported bug: this was the
    // same plain `background: url(...) center/cover` treatment as
    // Side Game Winner, which on a real device cropped the champion's
    // Favourite photo so heavily their head was entirely out of
    // frame -- on the single biggest reveal in the whole
    // presentation. Now uses the same shared PresentationPhoto
    // treatment as Side Game Winner and Round Winner: the full photo
    // always stays visible, contained, never cropped.
    const names = slide.champions.map(c => c.playerName).join(slide.hasTie ? ' & ' : '')
    return (
      <PresentationPhoto imageUrl={slide.photoUrl} overlay={slide.photoUrl ? 'dark' : undefined}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 24px 48px', textAlign: 'center',
          justifyContent: slide.photoUrl ? 'flex-end' : 'center',
          background: slide.photoUrl ? undefined : 'linear-gradient(160deg, #0a1f14 0%, #14532d 55%, #1a4731 100%)',
        }}>
          <p style={{ fontSize: 'clamp(36px, 6vw, 56px)', marginBottom: 6 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.9, 40), letterSpacing: '0.2em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 14 }}>Event {slide.hasTie ? 'Co-Champions' : 'Champion'}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(28, 6, 120), fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 12, lineHeight: 1.08, overflowWrap: 'anywhere' }}>{names}</p>
          <div style={{ width: 56, height: 2, background: '#fbbf24', marginBottom: 12 }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(16, 2.8, 64), color: '#fff', fontWeight: 700 }}>{slide.champions[0]?.totalPoints} points</p>
        </div>
      </PresentationPhoto>
    )
  }
  if (slide.kind === 'leaderboard') {
    // V1.5 (15 Sep) -- fixed a genuine presentation bug found in live
    // testing: this previously used maxHeight + overflowY: auto,
    // which produced "only one large row visibly rendered, with an
    // internal scrollbar" -- a slideshow has no way for anyone to
    // scroll during playback. Fixed structurally: rows size via
    // clamp() rather than ever overflowing. That foundation is
    // unchanged below.
    // V1.6 (5 Oct) -- redesigned from a flat Top-10 list into a
    // podium with 1st place as an oversized hero row.
    // Real-device polish pass (10 Oct) -- that hero-row hierarchy is
    // what the real-device screenshot flagged as "too wide and
    // sparse, especially with only two players": `flex: 1.8/1.2/0.85`
    // on rows inside a `flex: 1` container made each row STRETCH
    // vertically to fill whatever space the other rows didn't use --
    // with only 1-2 entries, that's almost the entire 16:9 canvas,
    // producing a huge, sparse-looking card. Replaced with a compact,
    // non-stretching vertical stack (same principle the Round
    // Results slide below already uses successfully): fixed-ish row
    // heights via clamp(), centred as a group rather than stretched
    // to fill the frame, so 2 players and 5 players both read as a
    // deliberately-sized podium, not a half-empty or overflowing one.
    // Per the brief: positions 1-3 are now the SAME row height
    // (podium tier) -- gold/silver/bronze is colour and border only,
    // not a size hierarchy -- and 4-5 are visibly simpler/smaller,
    // subordinate rows. Position/name/score sit in the same
    // fixed-width columns on every row, podium or plain, so they line
    // up down the whole list regardless of tier.
    // First place gets the trophy ONLY when an overall champion was declared.
    const noChampion = slide.championDeclared === false
    const medalFor = (position: number) => position === 1 ? (noChampion ? '\u{1F947}' : '\u{1F3C6}') : position === 2 ? '\u{1F948}' : position === 3 ? '\u{1F949}' : null
    // V1.11 (7 Oct) -- the approved Final Leaderboard artwork
    // (public/images/final-leaderboard-template.jpg) already carries
    // the trophy, "FINAL LEADERBOARD" title, gold border and
    // branding -- none of that is rendered here. Unchanged by this
    // pass, per the explicit "don't replace or re-generate this
    // artwork" instruction -- only the dynamic results overlay below
    // is a code/layout change.
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundImage: 'url(/images/final-leaderboard-template.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', padding: `15.75cqw ${sz(50, 7, 160)} ${CONTROLS_SAFE_AREA_PX + 10}px` }}>
        <div data-testid="leaderboard-rows" style={{ width: 'min(100%, 62cqw)', display: 'flex', flexDirection: 'column', gap: sz(5, 0.8, 18) }}>
          {slide.endedEarly && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(11, 1.5, 34), fontWeight: 800, letterSpacing: '0.16em', color: '#fbbf24', textAlign: 'center', textTransform: 'uppercase', margin: '0 0 2px' }}>
              {'Final standings \u00b7 Event ended early'}
            </p>
          )}
          {slide.entries.map(e => {
            const isPodium = e.position <= 3
            const tier = e.position === 1 ? 'gold' : e.position === 2 ? 'silver' : e.position === 3 ? 'bronze' : 'plain'
            // 27 Oct: a dark base under every tint so rank, name and points stay readable over the bright sunset artwork.
            const darken = 'linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.42))'
            const background = tier === 'gold' ? `${darken}, linear-gradient(135deg, rgba(251,191,36,0.34), rgba(251,191,36,0.14))`
              : tier === 'silver' ? `${darken}, linear-gradient(rgba(226,232,240,0.16), rgba(226,232,240,0.16))`
              : tier === 'bronze' ? `${darken}, linear-gradient(rgba(205,140,74,0.18), rgba(205,140,74,0.18))`
              : `${darken}, linear-gradient(rgba(255,255,255,0.04), rgba(255,255,255,0.04))`
            const border = tier === 'gold' ? '1.5px solid rgba(251,191,36,0.6)'
              : tier === 'silver' ? '1px solid rgba(226,232,240,0.35)'
              : tier === 'bronze' ? '1px solid rgba(205,140,74,0.4)'
              : 'none'
            const scoreColor = tier === 'gold' ? '#fbbf24' : tier === 'silver' ? '#e2e8f0' : tier === 'bronze' ? '#e8b176' : '#e5e7eb'
            return (
              <div key={e.position} style={{
                display: 'flex', alignItems: 'center', gap: sz(8, 1.2, 28),
                // Equal height across all three podium positions (1-3)
                // -- gold is distinguished by colour/border, never by
                // being physically bigger. 4-5 get a visibly smaller,
                // plainer row.
                padding: isPodium ? `${sz(7, 1.0, 26)} ${sz(12, 1.8, 44)}` : `${sz(4, 0.6, 16)} ${sz(10, 1.5, 36)}`,
                borderRadius: isPodium ? sz(10, 1.4, 32) : sz(7, 1, 22),
                background, border,
                boxShadow: tier === 'gold' ? '0 3px 14px rgba(0,0,0,0.35)' : undefined,
              }}>
                <span style={{ fontSize: isPodium ? sz(17, 2.8, 62) : sz(13, 2.1, 46), fontWeight: 800, color: isPodium ? '#fff' : '#d9c9a3', flexShrink: 0, width: sz(32, 4.6, 100), textAlign: 'center' }}>
                  {medalFor(e.position) ?? e.position}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-body)', fontSize: isPodium ? sz(15, 2.8, 62) : sz(12, 2.1, 46), fontWeight: isPodium ? 800 : 600, color: isPodium ? '#fff' : '#e5e7eb', textShadow: '0 1px 3px rgba(0,0,0,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.playerName}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isPodium ? sz(15, 2.8, 62) : sz(12, 2.1, 46), fontWeight: 800, color: scoreColor, flexShrink: 0, minWidth: sz(28, 4, 90), textAlign: 'right' }}>
                  {e.totalPoints}
                </span>
              </div>
            )
          })}
          {moreTiedText(slide.moreTied) && <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(11, 1.5, 32), color: '#d1d5db', textAlign: 'center', margin: '2px 0 0', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{moreTiedText(slide.moreTied)}</p>}
        </div>
      </div>
    )
  }
  if (slide.kind === 'roundResults') {
    // V1.6 (5 Oct) -- fixed a real, serious bug found during this
    // session's own audit: this slide kind existed in the Slide union
    // (added when Round Winner shipped) but had no renderer at all
    // here -- every roundResults slide was silently falling through
    // to the generic closing-slide fallback at the end of this
    // function, which is exactly what the brief described as "random
    // Teein' It Up filler slides appearing unexpectedly within the
    // presentation." Never reproduced the same class of bug while
    // fixing it: every slide kind added or changed in this same
    // session was cross-checked against this function's own coverage
    // before considering the work done (see the delivery report).
    // V1.14 (8 Oct) -- replaced entirely, per explicit product
    // correction: this round's own Top-5 standings, never a photo-led
    // winner card, never Group Photo as a fallback. Position 1 is
    // labelled ROUND WINNER distinctly; positions 2-5 (or fewer, never
    // padded) are shown plainly below it. This is THIS ROUND's own
    // scoring only (slide.standings comes from determineRoundStandings,
    // fed this round's own scorecards) -- never cumulative event
    // standings, which remain the separate, untouched Final Leaderboard
    // slide.
    return (
      <GenericTemplateSlide>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.9, 42), fontWeight: 700, letterSpacing: '0.2em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: sz(3, 0.5, 12) }}>{slide.roundName}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(24, 4.6, 96), fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: sz(10, 1.8, 40), lineHeight: 1.05 }}>Results</p>
        <div data-testid="results-rows" style={{ width: 'min(68cqw, 1500px)', display: 'flex', flexDirection: 'column', gap: sz(5, 0.9, 20) }}>
          {slide.standings.map(s => {
            const isWinner = s.position === 1
            return (
              <div key={s.playerId} style={{
                display: 'flex', alignItems: 'center', gap: sz(8, 1.4, 30),
                padding: isWinner ? `${sz(8, 1.3, 30)} ${sz(14, 2.2, 52)}` : `${sz(5, 0.85, 20)} ${sz(12, 2, 46)}`,
                borderRadius: isWinner ? sz(12, 1.6, 36) : sz(8, 1.1, 26),
                background: isWinner ? 'linear-gradient(135deg, rgba(251,191,36,0.3), rgba(251,191,36,0.1))' : 'rgba(255,255,255,0.08)',
                border: isWinner ? '2px solid rgba(251,191,36,0.6)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: isWinner ? sz(20, 3.6, 80) : sz(15, 2.7, 60), fontWeight: 800, color: isWinner ? '#fbbf24' : '#d9c9a3', width: sz(28, 4, 90), flexShrink: 0, textAlign: 'center' }}>{s.position}</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-body)', fontSize: isWinner ? sz(18, 3.6, 78) : sz(15, 2.8, 62), fontWeight: isWinner ? 800 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.playerName}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isWinner ? sz(18, 3.6, 78) : sz(15, 2.8, 62), fontWeight: 800, color: isWinner ? '#fbbf24' : '#f3f4f6', flexShrink: 0 }}>{s.roundPoints} pts</span>
                {isWinner && <span style={{ fontFamily: 'var(--font-body)', fontSize: sz(11, 1.5, 32), letterSpacing: '0.12em', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 800, flexShrink: 0 }}>Round Winner</span>}
              </div>
            )
          })}
        </div>
        {moreTiedText(slide.moreTied) && <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(12, 1.6, 34), color: '#d1d5db', marginTop: sz(6, 1, 22), textAlign: 'center' }}>{moreTiedText(slide.moreTied)}</p>}
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'cumulativeResults') {
    // 18 Oct field test -- "Total Scores after Round N": cumulative standings
    // through this round, shown right after that round's own (unchanged)
    // Results slide. Same premium template and row styling as Results; the
    // leader is highlighted but is NOT called the round winner.
    return (
      <GenericTemplateSlide>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.9, 42), fontWeight: 700, letterSpacing: '0.2em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: sz(3, 0.5, 12) }}>After {slide.roundName}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(24, 4.6, 96), fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: sz(10, 1.8, 40), textAlign: 'center', lineHeight: 1.05 }}>Total Scores</p>
        <div data-testid="results-rows" style={{ width: 'min(68cqw, 1500px)', display: 'flex', flexDirection: 'column', gap: sz(5, 0.9, 20) }}>
          {slide.standings.map(s => {
            const isLeader = s.position === 1
            return (
              <div key={s.playerId} style={{
                display: 'flex', alignItems: 'center', gap: sz(8, 1.4, 30),
                padding: isLeader ? `${sz(8, 1.3, 30)} ${sz(14, 2.2, 52)}` : `${sz(5, 0.85, 20)} ${sz(12, 2, 46)}`,
                borderRadius: isLeader ? sz(12, 1.6, 36) : sz(8, 1.1, 26),
                background: isLeader ? 'linear-gradient(135deg, rgba(251,191,36,0.3), rgba(251,191,36,0.1))' : 'rgba(255,255,255,0.08)',
                border: isLeader ? '2px solid rgba(251,191,36,0.6)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: isLeader ? sz(20, 3.6, 80) : sz(15, 2.7, 60), fontWeight: 800, color: isLeader ? '#fbbf24' : '#d9c9a3', width: sz(28, 4, 90), flexShrink: 0, textAlign: 'center' }}>{s.position}</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-body)', fontSize: isLeader ? sz(18, 3.6, 78) : sz(15, 2.8, 62), fontWeight: isLeader ? 800 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.playerName}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isLeader ? sz(18, 3.6, 78) : sz(15, 2.8, 62), fontWeight: 800, color: isLeader ? '#fbbf24' : '#f3f4f6', flexShrink: 0 }}>{s.totalPoints} pts</span>
                
              </div>
            )
          })}
        </div>
        {moreTiedText(slide.moreTied) && <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(12, 1.6, 34), color: '#d1d5db', marginTop: sz(6, 1, 22), textAlign: 'center' }}>{moreTiedText(slide.moreTied)}</p>}
        <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(12, 1.6, 34), color: '#d1d5db', marginTop: sz(6, 1, 22), textAlign: 'center' }}>Combined Stableford points, {slide.roundsIncluded} rounds</p>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'bloopersDivider') {
    // V1.18 (10 Oct), Package 4 -- renamed from "Bloopers & Outtakes"
    // to "Moments & Bloopers", per the approved brief: this chapter now
    // also carries unassigned event-level uploads, not just Blooper-
    // tagged clips, so the title and subtitle reflect that wider scope.
    // Only the SLIDESHOW SECTION's own name/scope changes here -- the
    // underlying Blooper classification in Event Memories itself is
    // untouched (Package 7's explicit hard boundary).
    return (
      <GenericTemplateSlide>
        <p style={{ fontSize: 32, marginBottom: 10 }}>🎬</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', letterSpacing: 2 }}>MOMENTS &amp; BLOOPERS</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#d9c9a3', marginTop: 10 }}>Keep the memories playing after the awards.</p>
      </GenericTemplateSlide>
    )
  }
  if (slide.kind === 'blooper') {
    // V1.6 (5 Oct) -- fixed a real bug found continuing this session:
    // this still referenced slide.videoUrl, a field name that no
    // longer exists on the Slide type (renamed to imageUrl when
    // Bloopers were widened to include photos) -- would have rendered
    // "Video unavailable" for every single Blooper, photo and video
    // alike, since the field was always undefined. Branches on
    // mediaType now: a video Blooper plays as before; a photo Blooper
    // renders as a plain image, exactly like an ordinary photo slide,
    // just within the Bloopers chapter.
    // V1.18 (10 Oct), Package 5.2 -- "Transitions = Gentle fade" for
    // the aftershow chapter. A lightweight CSS opacity fade, keyed by
    // momentId so it genuinely replays on every new aftershow slide
    // (React remounts this div when the key changes) -- additive only,
    // scoped entirely to this one slide kind's own wrapper, never
    // touching any other slide's rendering or timing.
    return (
      <div key={slide.momentId} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', animation: 'ttuAftershowFade 0.5s ease' }}>
        {slide.mediaType === 'video' ? (
          slide.imageUrl ? (
            <video
              ref={videoRef}
              src={slide.imageUrl}
              muted={videoMuted}
              playsInline
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onLoadedMetadata={(e) => onMediaSize?.(slide.momentId, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              onError={onVideoFailed}
            />
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Video unavailable</p>
          )
        ) : (
          slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slide.imageUrl} alt={slide.caption ?? 'Blooper'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onLoad={(e) => onMediaSize?.(slide.momentId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Photo unavailable</p>
          )
        )}
        {(slide.playerName || slide.caption) && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: CONTROLS_SAFE_AREA_PX, padding: '24px 20px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
            {slide.playerName && <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(16, 2.2, 52), fontWeight: 700, color: '#fff' }}>{slide.playerName}</p>}
            {slide.caption && <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(13, 1.8, 40), color: '#e5e7eb', marginTop: 2, overflowWrap: 'anywhere' }}>{slide.caption}</p>}
          </div>
        )}
      </div>
    )
  }
  // closing
  // Phase E (11 Oct) verification pass -- corrected static artwork
  // supplied by the user, replacing the Task #59 Option B blur/DOM-text
  // treatment. Because every word on this slide ("What a Great Event!",
  // both sublines, and the tagline) is fixed copy with no per-event
  // data, there is no actual need for a DOM text layer here -- the
  // earlier blur treatment was solving a problem ("how do we style 'My
  // Golf' without baking it into a static image") that doesn't apply
  // once a corrected image with the right wording/emphasis already
  // exists. This renders event-highlights-closing-v2.jpg full-bleed,
  // crisp, with no blur and no overlay -- the "My Golf" gold/bold/
  // underline emphasis is now part of the artwork itself, confirmed by
  // direct visual inspection of the supplied image before wiring it in.
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a1410' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the full, final slide artwork; no DOM text overlay needed */}
      <img
        src="/images/event-highlights-closing-v2.jpg"
        alt="What a great event! Check out all your event memories and stats in My Golf. See you at the next one! Run your golf event like a pro."
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}

/**
 * MomentsSourceLabel -- Presentation UX polish (12 Oct). A small, branded
 * "this lives in My Golf" signature for Moment and Blooper slides, so
 * players learn where to find the photo afterwards.
 *
 * Placement is decided by the media's real aspect ratio against the 16:9
 * canvas (all sizes in `cqw`, 1% of canvas width; the canvas is 56.25cqw
 * tall):
 *  - Portrait/squarish media leaves pillarbox space either side. If that
 *    space is wide enough, a branded green/gold card sits in the RIGHT
 *    pillarbox, vertically centred -- clear of the photo, the close
 *    button (top-right) and the mute button (bottom-right).
 *  - Landscape media fills the frame, so a small translucent pill sits in
 *    the top-left corner instead -- the lightest overlay possible, in the
 *    area least likely to hold faces.
 * The photo/video itself is never cropped, scaled or moved: this is an
 * extra layer only. pointer-events are off so taps/seeks pass through.
 */
function MomentsSourceLabel({ heading, aspect }: { heading: string; aspect: number }) {
  const placement = momentsLabelPlacement(aspect)
  const sideSpace = pillarboxCqw(aspect)
  const gold = '#fbbf24'
  const card: React.CSSProperties = {
    background: 'linear-gradient(160deg, rgba(10,43,26,0.86), rgba(20,83,45,0.78))',
    border: '1px solid rgba(232,201,106,0.55)',
    boxShadow: '0 0.3cqw 1.4cqw rgba(0,0,0,0.45)',
  }
  // Only genuinely portrait/square media gets the side card; squarer-than-
  // that leaves too little pillarbox to read on a phone, so it uses the
  // corner pill (see momentsLabelPlacement).
  if (placement.mode === 'side') {
    const font = Math.min(1.7, Math.max(1.2, (sideSpace - 3) / 9.2))
    return (
      <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${sideSpace}cqw`, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ ...card, boxSizing: 'border-box', width: `${sideSpace - 2.4}cqw`, borderRadius: '1cqw', padding: '1.4cqw 1cqw', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: `${font}cqw`, fontWeight: 800, letterSpacing: '0.12em', color: gold }}>{heading}</p>
          <div style={{ width: '40%', height: 1, background: 'rgba(232,201,106,0.7)', margin: '0.9cqw auto' }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: `${font * 0.82}cqw`, lineHeight: 1.35, color: '#fff', fontWeight: 600 }}>
            Relive it in<br /><span style={{ color: gold, fontWeight: 800 }}>My Golf &rarr; Moments</span>
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: `${font * 0.6}cqw`, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.7)', fontWeight: 700, marginTop: '1cqw' }}>TEEIN&rsquo; IT UP</p>
        </div>
      </div>
    )
  }
  return (
    <div aria-hidden style={{ position: 'absolute', top: '2cqw', left: '2cqw', pointerEvents: 'none', ...card, borderRadius: '0.8cqw', padding: '0.7cqw 1.3cqw' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: sz(11, 1.5, 30), fontWeight: 800, letterSpacing: '0.12em', color: gold }}>{heading}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: sz(11, 1.4, 28), color: '#fff', fontWeight: 600, marginTop: '0.2cqw' }}>
        Relive it in <span style={{ color: gold, fontWeight: 800 }}>My Golf &rarr; Moments</span>
      </p>
    </div>
  )
}

function navButtonStyle(disabled: boolean): React.CSSProperties {
  return { width: 44, height: 44, borderRadius: 22, border: 'none', background: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 22, cursor: disabled ? 'default' : 'pointer' }
}
const playButtonStyle: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 26, border: 'none', background: '#1a4731', color: '#fff', fontSize: 19, cursor: 'pointer',
}
