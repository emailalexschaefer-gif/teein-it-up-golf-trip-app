'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { Slide } from '@/lib/trips/slideshowDeck'

/**
 * Event Memories V1.2 (12 Sep) -- the Event Highlights fullscreen
 * player. Extended V1.4 (14 Sep) for a 16:9 presentation canvas,
 * group photo/Bloopers slide rendering, video playback, and a
 * protected controls safe-area.
 *
 * 16:9 PRESENTATION CANVAS: the brief's own "separate the presentation
 * canvas from the device viewport" instruction. A fixed-aspect-ratio
 * canvas (width/height derived via the standard CSS "fit an aspect
 * ratio inside an arbitrary viewport" calculation: min(100vw,
 * 100vh*16/9) and min(100vh, 100vw*9/16)) is centred within whatever
 * the actual device viewport is. On a TV/landscape device this canvas
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
 * FULLSCREEN: requests the browser's Fullscreen API on Play; if the
 * browser refuses or doesn't support it (confirmed with a feature
 * check, not just a try/catch on the call), the player still works as
 * a full-viewport overlay -- never unusable merely because
 * programmatic fullscreen was refused.
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

const CONTROLS_SAFE_AREA_PX = 96

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

export default function EventHighlightsPlayer({ slides, durationSeconds, onExit, aftershowStartIndex, aftershowLoop }: EventHighlightsPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
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
  const [videoMuted, setVideoMuted] = useState(true)
  // V1.10 (6 Oct) -- Priority 6: true only if, after fullscreen and
  // orientation-lock were both attempted, the device is still
  // genuinely detectable as portrait. Dismissible; never blocks playback.
  const [showRotateHint, setShowRotateHint] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Per-slide duration: photo slides use the chosen duration; title/
  // divider/closing slides stay visible a little longer. A video
  // Blooper slide's own timer is a FALLBACK only -- its real duration
  // comes from the video's own `ended` event (see the effect below);
  // this value is used if that event never fires (a failed/stalled
  // clip).
  const slideDurationMs = isVideoBlooper(current)
    ? ((current.durationSeconds ?? durationSeconds) + 3) * 1000
    : (current?.kind === 'photo' || (isBlooper(current) && current.mediaType === 'photo') ? durationSeconds : durationSeconds + 2) * 1000

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
    if (!playing) return
    const atEnd = index >= slides.length - 1
    const willLoop = atEnd && canLoopAftershow && aftershowStartIndex! <= index
    if (atEnd && !willLoop) { setPlaying(false); return }
    advanceTimer.current = setTimeout(advance, slideDurationMs)
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }
  }, [index, playing, slideDurationMs, advance, slides.length, canLoopAftershow, aftershowStartIndex])

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
    const el = containerRef.current
    let cancelled = false

    async function enterPresentationMode() {
      if (el && document.fullscreenEnabled && el.requestFullscreen) {
        try { await el.requestFullscreen() } catch { /* fullscreen refused -- still works as a full-viewport overlay */ }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = (screen as any).orientation
      if (orientation && typeof orientation.lock === 'function') {
        try { await orientation.lock('landscape') } catch { /* locking unsupported/rejected -- fall through to the portrait check below */ }
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

    if ('wakeLock' in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock.request('screen')
        .then((lock: { release: () => Promise<void> }) => { wakeLockRef.current = lock })
        .catch(() => { /* wake lock unavailable/denied -- not a dependency */ })
    }
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = (screen as any).orientation
      if (orientation && typeof orientation.unlock === 'function') {
        try { orientation.unlock() } catch { /* nothing to unlock, or already unlocked -- harmless either way */ }
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      wakeLockRef.current?.release().catch(() => {})
    }
  }, [])

  // Controls auto-hide during playback, reappear on interaction.
  const bumpControls = useCallback(() => {
    setControlsVisible(true)
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    if (playing) hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 2500)
  }, [playing])
  useEffect(() => { bumpControls() }, [index, playing, bumpControls])

  // Keyboard controls (desktop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') { goTo(index + 1); bumpControls() }
      else if (e.key === 'ArrowLeft') { goTo(index - 1); bumpControls() }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); bumpControls() }
      else if (e.key === 'Escape') { onExit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, goTo, bumpControls, onExit])

  function renderPhoto(slide: Extract<Slide, { kind: 'photo' }> | undefined, visible: boolean) {
    if (!slide || !slide.imageUrl) return null
    const failed = failedUrls.has(slide.imageUrl)
    return (
      <div style={{ position: 'absolute', inset: 0, display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
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
              onError={() => setFailedUrls(prev => new Set(prev).add(slide.imageUrl!))}
            />
          </>
        )}
      </div>
    )
  }

  const current16x9Photo = isPhoto(current) ? current : undefined

  return (
    <div
      ref={containerRef}
      onClick={bumpControls}
      onTouchStart={bumpControls}
      style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 100, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {/* V1.18 (10 Oct), Package 5.2 -- the aftershow's "gentle fade"
          transition keyframe, defined once here rather than per-slide. */}
      <style>{'@keyframes ttuAftershowFade { from { opacity: 0 } to { opacity: 1 } }'}</style>
      {/* 16:9 presentation canvas -- letterboxes on a portrait device,
          fills on landscape/TV. Everything slide-related renders
          inside this fixed-ratio box, never directly against the raw
          device viewport. */}
      <div style={{
        position: 'relative', background: '#000', overflow: 'hidden',
        width: 'min(100vw, calc(100vh * 16 / 9))',
        height: 'min(100vh, calc(100vw * 9 / 16))',
      }}>
        {/* Preload current + adjacent photo slides only -- never the whole deck. */}
        {renderPhoto(isPhoto(slides[index - 1]) ? slides[index - 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}
        {renderPhoto(current16x9Photo, true)}
        {renderPhoto(isPhoto(slides[index + 1]) ? slides[index + 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}

        {!isPhoto(current) && (
          <NonPhotoSlide
            slide={current}
            videoRef={videoRef}
            videoMuted={videoMuted}
            onVideoFailed={() => advance()}
          />
        )}

        {/* Photo context overlay -- subtle, never competing with the
            photograph, and kept clear of the controls safe-area strip. */}
        {isPhoto(current) && (current.roundName || current.holeNumber || current.playerName || current.sideCompName || current.caption) && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: CONTROLS_SAFE_AREA_PX, padding: '28px 20px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
            {(current.roundName || current.holeNumber) && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#d9c9a3', textTransform: 'uppercase', marginBottom: 2 }}>
                {[current.roundName, current.holeNumber ? `Hole ${current.holeNumber}` : null].filter(Boolean).join(' \u00b7 ')}
              </p>
            )}
            {current.sideCompName && (
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{current.sideCompName}</p>
            )}
            {current.playerName && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#fff' }}>{current.playerName}</p>
            )}
            {current.caption && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e5e7eb', marginTop: 4 }}>{current.caption}</p>
            )}
          </div>
        )}

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
        <div style={{ position: 'absolute', inset: 0, opacity: controlsVisible ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: controlsVisible ? 'auto' : 'none' }}>
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

function NonPhotoSlide({ slide, videoRef, videoMuted, onVideoFailed }: {
  slide: Slide
  videoRef: React.RefObject<HTMLVideoElement | null>
  videoMuted: boolean
  onVideoFailed: () => void
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
          {slide.dateRange && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(12px, 1.5vw, 16px)', color: '#f0e6d2', letterSpacing: 0.5, textShadow: '0 1px 6px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.9)' }}>{slide.dateRange}</p>}
        </div>
      </div>
    )
  }
  if (slide.kind === 'eventAtAGlance') {
    // V1.17 (10 Oct) -- final approved backdrop integration, replacing
    // the prior blurred-derivative + composited-logo treatment
    // entirely. The newly approved artwork (event-at-a-glance-bg.jpg)
    // already has the Teein' It Up logo, the gold horizontal decorative
    // lines, the three gold vertical column dividers, and the closing
    // phrase "This is how it unfolded." all baked in at full
    // resolution -- so none of those are rendered a second time here.
    // Doing so previously caused the reported "two logos" bug (one
    // composited top, one composited bottom-right, both on top of a
    // background that -- before this artwork -- couldn't carry its own
    // baked-in logo). This version renders ONLY the four live data
    // columns on top of the artwork; the artwork alone supplies every
    // other visual element.
    //
    // Column x-positions are measured directly from the approved
    // artwork's own three gold vertical dividers (sampled at multiple
    // rows, consistently at 34.2% / 50.2% / 66.6% of width), not
    // guessed -- so each column's centred text lines up with the real
    // dividers already printed in the image: Rounds 0-34.2% (widest,
    // since it alone carries course names), Holes 34.2-50.2%, Side
    // Games 50.2-66.6%, Event Champion 66.6-100% (widest of the
    // remaining three, matching the artwork's own wider right-hand
    // panel). No CSS divider lines are drawn -- the brief is explicit
    // that they already exist in the artwork.
    //
    // Icons are gold-only inline SVGs (GoldFlagIcon/GoldClubsIcon/
    // GoldCrownIcon, defined above), not emoji -- avoids each device's
    // own multi-colour default emoji rendering, per the explicit
    // "avoid brightly coloured emojis" requirement.
    //
    // Every number and name below is a live value from `slide`'s own
    // fields, computed from real event data -- nothing here is
    // rasterized, and the Event Champion column is no longer hardcoded
    // to "1" (see slideshowDeck.ts's championCount, sourced from the
    // same authoritative champions array the Champion slide itself
    // uses).
    return (
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/images/event-at-a-glance-bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {/* Statistics band -- vertically centred within the artwork's
            own empty middle zone (below the baked-in logo/horizontal
            lines, above the baked-in tagline), matching where the
            artwork's own gold vertical dividers actually run (measured
            13%-92% of height). Kept well clear of both ends so it can
            never crowd the baked-in elements on a short viewport. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '30%', bottom: '18%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
            {/* Column 1 -- Rounds, 0-34.2% of width. */}
            <div style={{ width: '34.2%', textAlign: 'center', minWidth: 0, padding: '0 clamp(4px, 1.2vw, 14px)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 4.4vw, 46px)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{slide.roundCount}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(9px, 1.2vw, 13px)', letterSpacing: 1.3, color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, marginTop: 4 }}>Round{slide.roundCount === 1 ? '' : 's'}</p>
              {slide.courseNames.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {slide.courseNames.map((name, i) => (
                    <p key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(7.5px, 0.9vw, 11px)', color: '#e5e7eb', lineHeight: 1.35, overflowWrap: 'break-word', marginTop: i === 0 ? 0 : 2 }}>{name}</p>
                  ))}
                </div>
              )}
            </div>
            {/* Column 2 -- Holes, 34.2%-50.2% of width (16%). */}
            <div style={{ width: '16%', textAlign: 'center', minWidth: 0, padding: '0 clamp(2px, 0.8vw, 10px)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 4.4vw, 46px)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{slide.totalHoles}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(9px, 1.2vw, 13px)', letterSpacing: 1.3, color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, marginTop: 4 }}>Hole{slide.totalHoles === 1 ? '' : 's'}</p>
              <div style={{ marginTop: 7, display: 'flex', justifyContent: 'center' }}><GoldFlagIcon size="clamp(12px, 1.8vw, 20px)" /></div>
            </div>
            {/* Column 3 -- Side Games, 50.2%-66.6% of width (16.4%). */}
            <div style={{ width: '16.4%', textAlign: 'center', minWidth: 0, padding: '0 clamp(2px, 0.8vw, 10px)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 4.4vw, 46px)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{slide.sideGameCount}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(9px, 1.2vw, 13px)', letterSpacing: 1.3, color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, marginTop: 4 }}>Side Game{slide.sideGameCount === 1 ? '' : 's'}</p>
              <div style={{ marginTop: 7, display: 'flex', justifyContent: 'center' }}><GoldClubsIcon size="clamp(12px, 1.8vw, 20px)" /></div>
            </div>
            {/* Column 4 -- Event Champion, 66.6%-100% of width (33.4%).
                Live championCount -- never hardcoded. */}
            <div style={{ width: '33.4%', textAlign: 'center', minWidth: 0, padding: '0 clamp(4px, 1.2vw, 14px)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 4.4vw, 46px)', fontWeight: 800, color: '#fbbf24', lineHeight: 1 }}>{slide.championCount}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(9px, 1.2vw, 13px)', letterSpacing: 1.3, color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, marginTop: 4, lineHeight: 1.25 }}>Event<br />Champion</p>
              <div style={{ marginTop: 7, display: 'flex', justifyContent: 'center' }}><GoldCrownIcon size="clamp(12px, 1.8vw, 20px)" /></div>
            </div>
          </div>
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
    return slide.winnerImageUrl ? (
      <PresentationPhoto imageUrl={slide.winnerImageUrl} overlay="dark">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '24px 24px 48px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, letterSpacing: 2, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 10 }}>{slide.label}{slide.holeNumber ? ` \u00b7 Hole ${slide.holeNumber}` : ''}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 8 }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#e5e7eb', letterSpacing: 1, textTransform: 'uppercase' }}>Winner</p>
        </div>
      </PresentationPhoto>
    ) : (
      <GenericTemplateSlide>
        <div style={{ border: '1.5px solid rgba(251,191,36,0.5)', borderRadius: 18, padding: '36px 44px', textAlign: 'center', background: 'rgba(0,0,0,0.15)' }}>
          <p style={{ fontSize: 30, marginBottom: 12 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, letterSpacing: 2.5, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 12 }}>{slide.label}{slide.holeNumber ? ` \u00b7 Hole ${slide.holeNumber}` : ''}</p>
          <div style={{ width: 36, height: 1.5, background: '#fbbf24', margin: '0 auto 16px' }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 10 }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#d9c9a3', letterSpacing: 1.5, textTransform: 'uppercase' }}>Winner</p>
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
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, letterSpacing: 2, color: '#d9c9a3', textTransform: 'uppercase', marginBottom: 10 }}>{slide.roundName}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', letterSpacing: 1 }}>Makers &amp; Breakers Badges</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 10 }}>Your badges live in MyGolf.</p>
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
        <div style={{ border: `1.5px solid ${accentColor}66`, borderRadius: 18, padding: '36px 44px', textAlign: 'center', background: `linear-gradient(160deg, ${accentColor}22, ${accentColor}08)`, maxWidth: 460 }}>
          <p style={{ fontSize: 34, marginBottom: 10 }}>{h.icon}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, letterSpacing: 2, color: accentColor, textTransform: 'uppercase', marginBottom: 8 }}>{h.kind === 'maker' ? 'Maker' : 'Breaker'}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3.4vw, 28px)', fontWeight: 800, color: '#fff', marginBottom: 10 }}>{h.title}</p>
          {roster ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: rosterIsLong ? 12.5 : 14.5, color: '#fff', marginBottom: 4, lineHeight: 1.5, overflowWrap: 'break-word' }}>{roster}</p>
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: '#fff', marginBottom: 4 }}>{h.playerName}</p>
          )}
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#d1d5db' }}>{h.statLine}</p>
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
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(12px, 1.6vw, 15px)', letterSpacing: 3, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 14 }}>Event {slide.hasTie ? 'Co-Champions' : 'Champion'}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 5.2vw, 48px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 12, lineHeight: 1.1 }}>{names}</p>
          <div style={{ width: 56, height: 2, background: '#fbbf24', marginBottom: 12 }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(15px, 2.2vw, 19px)', color: '#fff', fontWeight: 600 }}>{slide.champions[0]?.totalPoints} points</p>
        </div>
      </PresentationPhoto>
    )
  }
  if (slide.kind === 'leaderboard') {
    // V1.5 (15 Sep) -- fixed a genuine presentation bug found in live
    // testing: this previously used maxHeight + overflowY: auto,
    // which is exactly what produced "only one large row visibly
    // rendered, with an internal scrollbar" on a real landscape
    // screen -- a slideshow has no way for anyone to scroll during
    // playback, so that content was effectively just gone. Fixed
    // structurally, not by tuning a pixel value: the row list is now
    // a flex column that fills the available space and distributes
    // its rows with `justify-content: space-evenly` -- every row
    // genuinely fits inside the fixed space available, shrinking
    // together via clamp() font sizing on a shorter canvas, rather
    // than ever overflowing it. No overflow/scroll property appears
    // anywhere in this slide's layout now, by design, not by
    // accident -- confirmed directly, this is the single most
    // important property to get right here and is called out
    // specifically in the delivery report as the actual fix.
    // V1.6 (5 Oct) -- redesigned from a flat Top-10 list to a genuine
    // podium: 1st place is the hero row (largest, gold, trophy), 2nd/
    // 3rd get their own medal treatment, 4th/5th stay restrained --
    // per the brief's own explicit hierarchy. The non-scrolling,
    // clamp()-sized flex-column foundation from the V1.5 fix is
    // preserved unchanged -- only the row treatment itself changed.
    const medalFor = (position: number) => position === 1 ? '\u{1F3C6}' : position === 2 ? '\u{1F948}' : position === 3 ? '\u{1F949}' : null
    // V1.11 (7 Oct) -- switched to the dedicated, approved Final
    // Leaderboard artwork (public/images/final-leaderboard-
    // template.jpg). That artwork already contains the trophy, the
    // "FINAL LEADERBOARD" title, its own decorative underline, the
    // gold border, and the Teein' It Up branding -- all of that was
    // previously being rendered a second time here in HTML/CSS,
    // directly on top of where the artwork itself would eventually
    // carry it. Removed entirely, per the explicit "there must be ONE
    // Final Leaderboard title only" instruction. The results area
    // below now starts with generous top padding specifically sized
    // to clear the artwork's own baked-in header (confirmed by eye
    // against the supplied reference image -- the title/trophy
    // occupies roughly the top quarter of the 16:9 frame), so dynamic
    // results can never collide with it.
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundImage: 'url(/images/final-leaderboard-template.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', padding: `28vh clamp(60px, 8vw, 120px) ${CONTROLS_SAFE_AREA_PX + 10}px` }}>
        <div style={{ width: '100%', maxWidth: 560, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', gap: 'clamp(4px, 1vh, 8px)' }}>
          {slide.entries.map(e => {
            const isHero = e.position === 1
            const isMedal = e.position === 2 || e.position === 3
            return (
              <div key={e.position} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: isHero ? 'clamp(10px, 2vh, 18px) clamp(14px, 2.4vw, 22px)' : isMedal ? 'clamp(7px, 1.4vh, 12px) clamp(12px, 2vw, 18px)' : 'clamp(5px, 1vh, 9px) clamp(10px, 1.6vw, 16px)',
                borderRadius: isHero ? 16 : 10,
                background: isHero ? 'linear-gradient(135deg, rgba(251,191,36,0.32), rgba(251,191,36,0.1))' : isMedal ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: isHero ? '1.5px solid rgba(251,191,36,0.6)' : isMedal ? '1px solid rgba(255,255,255,0.15)' : 'none',
                boxShadow: isHero ? '0 4px 18px rgba(0,0,0,0.35)' : undefined,
                flex: isHero ? '1.8 1 0' : isMedal ? '1.2 1 0' : '0.85 1 0', minHeight: 0,
              }}>
                <span style={{ fontSize: isHero ? 'clamp(22px, 4vh, 34px)' : isMedal ? 'clamp(16px, 2.8vh, 24px)' : 'clamp(13px, 2vh, 17px)', flexShrink: 0, width: isHero ? 44 : 32, textAlign: 'center' }}>
                  {medalFor(e.position) ?? e.position}
                </span>
                <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: isHero ? 'clamp(16px, 2.8vh, 24px)' : isMedal ? 'clamp(13px, 2.2vh, 18px)' : 'clamp(11px, 1.8vh, 14px)', fontWeight: isHero ? 800 : isMedal ? 600 : 400, color: isHero ? '#fff' : isMedal ? '#fff' : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.playerName}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isHero ? 'clamp(16px, 2.8vh, 24px)' : isMedal ? 'clamp(13px, 2.2vh, 18px)' : 'clamp(11px, 1.8vh, 14px)', fontWeight: 700, color: isHero ? '#fbbf24' : isMedal ? '#d9c9a3' : '#9ca3af', flexShrink: 0 }}>
                  {e.totalPoints}
                </span>
              </div>
            )
          })}
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
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, letterSpacing: 2.5, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 4 }}>{slide.roundName}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 16 }}>Results</p>
        <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slide.standings.map(s => {
            const isWinner = s.position === 1
            return (
              <div key={s.playerId} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: isWinner ? '10px 16px' : '6px 14px',
                borderRadius: isWinner ? 12 : 8,
                background: isWinner ? 'linear-gradient(135deg, rgba(251,191,36,0.28), rgba(251,191,36,0.08))' : 'rgba(255,255,255,0.06)',
                border: isWinner ? '1.5px solid rgba(251,191,36,0.55)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: isWinner ? 20 : 15, fontWeight: 800, color: isWinner ? '#fbbf24' : '#d9c9a3', width: 24, flexShrink: 0, textAlign: 'center' }}>{s.position}</span>
                <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: isWinner ? 17 : 13.5, fontWeight: isWinner ? 800 : 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.playerName}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: isWinner ? 17 : 13.5, fontWeight: 700, color: isWinner ? '#fbbf24' : '#e5e7eb', flexShrink: 0 }}>{s.roundPoints} pts</span>
                {isWinner && <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, letterSpacing: 1, color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>Round Winner</span>}
              </div>
            )
          })}
        </div>
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
              onError={onVideoFailed}
            />
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Video unavailable</p>
          )
        ) : (
          slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slide.imageUrl} alt={slide.caption ?? 'Blooper'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Photo unavailable</p>
          )
        )}
        {(slide.playerName || slide.caption) && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: CONTROLS_SAFE_AREA_PX, padding: '24px 20px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
            {slide.playerName && <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#fff' }}>{slide.playerName}</p>}
            {slide.caption && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e5e7eb', marginTop: 2 }}>{slide.caption}</p>}
          </div>
        )}
      </div>
    )
  }
  // closing
  // V1.15 (9 Oct) -- replaced with the first approved closing-slide
  // artwork. V1.18 (10 Oct), Package 1 -- replaced AGAIN with the
  // final approved artwork (same filename and same 2.17:1 aspect
  // ratio as the V1.15 asset -- confirmed by direct pixel comparison
  // before replacing, not assumed -- so the `object-fit: contain`
  // treatment below, chosen specifically to avoid cropping on a true
  // 16:9 canvas, remains correct with no code change needed). Wording
  // order changed in this final version ("Check out all your event
  // memories and stats in MyGolf" now before "See you at the next
  // one!", not after) -- purely a different bake of the same artwork
  // asset; this component never renders any of that text itself, so
  // no rendering logic needed to change either way. The full
  // composition (headline, sublines, tagline, logo) is already baked
  // into the artwork itself and is deliberately generic -- no
  // event-specific text or CTA is overlaid here, matching the brief's
  // explicit "no duplicate text over the artwork" and "no feature
  // columns, sales panels or large promotional buttons" requirements.
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0a1410' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/event-highlights-closing.jpg"
        alt="What a great event! Check out all your event memories and stats in MyGolf. See you at the next one. Run your golf event like a pro."
        style={{ position: 'absolute', inset: 0, margin: 'auto', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}

function navButtonStyle(disabled: boolean): React.CSSProperties {
  return { width: 44, height: 44, borderRadius: 22, border: 'none', background: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 22, cursor: disabled ? 'default' : 'pointer' }
}
const playButtonStyle: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 26, border: 'none', background: '#1a4731', color: '#fff', fontSize: 19, cursor: 'pointer',
}
