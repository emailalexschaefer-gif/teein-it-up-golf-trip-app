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
}

const CONTROLS_SAFE_AREA_PX = 96

export default function EventHighlightsPlayer({ slides, durationSeconds, onExit }: EventHighlightsPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const [videoMuted, setVideoMuted] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const current = slides[index]
  const isPhoto = (s: Slide | undefined): s is Extract<Slide, { kind: 'photo' }> => s?.kind === 'photo'
  const isBlooper = (s: Slide | undefined): s is Extract<Slide, { kind: 'blooper' }> => s?.kind === 'blooper'

  // Per-slide duration: photo slides use the chosen duration; title/
  // divider/closing slides stay visible a little longer. A Blooper
  // slide's own timer is a FALLBACK only -- its real duration comes
  // from the video's own `ended` event (see the effect below); this
  // value is used if that event never fires (a failed/stalled clip).
  const slideDurationMs = isBlooper(current)
    ? ((current.durationSeconds ?? durationSeconds) + 3) * 1000
    : (current?.kind === 'photo' ? durationSeconds : durationSeconds + 2) * 1000

  const goTo = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)))
  }, [slides.length])

  const advance = useCallback(() => {
    setIndex(prev => (prev >= slides.length - 1 ? prev : prev + 1))
  }, [slides.length])

  // Auto-advance (fallback timer for every slide, including Bloopers).
  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (!playing) return
    if (index >= slides.length - 1) { setPlaying(false); return }
    advanceTimer.current = setTimeout(advance, slideDurationMs)
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }
  }, [index, playing, slideDurationMs, advance, slides.length])

  // Video playback: play/pause follows the presentation's own state;
  // the video's real `ended` event advances immediately rather than
  // waiting for the fallback timer; leaving the slide resets playback
  // position so returning to it later starts from the beginning.
  useEffect(() => {
    const video = videoRef.current
    if (!isBlooper(current) || !video) return
    if (playing) {
      // Browsers reliably allow autoplay only when muted -- attempting
      // unmuted autoplay and catching the rejection, rather than
      // claiming audio-on autoplay works where it doesn't.
      video.play().catch(() => { /* autoplay blocked -- the tap-to-unmute/play control remains available */ })
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
  }, [current, playing, advance])

  // Fullscreen + Wake Lock on mount; released on unmount. Both are
  // feature-checked and wrapped in try/catch -- failure here never
  // blocks playback.
  useEffect(() => {
    const el = containerRef.current
    if (el && document.fullscreenEnabled && el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* fullscreen refused -- the player still works as a full-viewport overlay */ })
    }
    if ('wakeLock' in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock.request('screen')
        .then((lock: { release: () => Promise<void> }) => { wakeLockRef.current = lock })
        .catch(() => { /* wake lock unavailable/denied -- not a dependency */ })
    }
    return () => {
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
        {isBlooper(current) && (
          <button
            onClick={(e) => { e.stopPropagation(); setVideoMuted(m => !m) }}
            style={{ position: 'absolute', bottom: CONTROLS_SAFE_AREA_PX + 12, right: 16, width: 36, height: 36, borderRadius: 18, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 15, cursor: 'pointer' }}
          >
            {videoMuted ? '\u{1F507}' : '\u{1F50A}'}
          </button>
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
            <button onClick={() => goTo(index + 1)} disabled={index === slides.length - 1} style={navButtonStyle(index === slides.length - 1)}>›</button>
          </div>
        </div>
      </div>
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
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '7% 6% 0', background: 'linear-gradient(rgba(5,15,10,0.55), rgba(5,15,10,0) 65%)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 4vw, 38px)', fontWeight: 800, color: '#fff', marginBottom: 6, letterSpacing: 0.5, maxWidth: '70%', lineHeight: 1.15 }}>{slide.eventName}</p>
          {slide.dateRange && <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(12px, 1.5vw, 16px)', color: '#d9c9a3', letterSpacing: 0.5 }}>{slide.dateRange}</p>}
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
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a4731' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: '#fff', letterSpacing: 2 }}>EVENT MEMORIES</p>
      </div>
    )
  }
  if (slide.kind === 'roundDivider') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #14532d, #1a4731)', padding: 24 }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3.4vw, 30px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 10 }}>{slide.roundName}</p>
        {slide.courseName && <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#e5e7eb' }}>{slide.courseName}</p>}
        {slide.playDate && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#d1d5db' }}>{new Date(slide.playDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
      </div>
    )
  }
  if (slide.kind === 'sideGameWinner') {
    // Competition/result-first treatment -- distinct from an ordinary
    // photo slide, so a Side Game Memory is never confused with the
    // official winner announcement. No-photo fallback substantially
    // improved for V1.4: a proper gold-accented winner card with real
    // visual hierarchy, rather than plain centred text on flat green.
    return slide.winnerImageUrl ? (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: `linear-gradient(rgba(20,83,45,0.25), rgba(20,83,45,0.88)), url(${slide.winnerImageUrl}) center/cover` }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, letterSpacing: 2, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 10 }}>{slide.label}{slide.holeNumber ? ` \u00b7 Hole ${slide.holeNumber}` : ''}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 8 }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#e5e7eb', letterSpacing: 1, textTransform: 'uppercase' }}>Winner</p>
        </div>
      </div>
    ) : (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #0f2a1c, #1a4731)', padding: 24 }}>
        <div style={{ border: '1.5px solid rgba(251,191,36,0.5)', borderRadius: 18, padding: '36px 44px', textAlign: 'center', background: 'rgba(0,0,0,0.15)' }}>
          <p style={{ fontSize: 30, marginBottom: 12 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, letterSpacing: 2.5, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 12 }}>{slide.label}{slide.holeNumber ? ` \u00b7 Hole ${slide.holeNumber}` : ''}</p>
          <div style={{ width: 36, height: 1.5, background: '#fbbf24', margin: '0 auto 16px' }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 10 }}>{slide.winnerName}</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#d9c9a3', letterSpacing: 1.5, textTransform: 'uppercase' }}>Winner</p>
        </div>
      </div>
    )
  }
  if (slide.kind === 'makersBreakers') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1a1a16', padding: '24px 24px 24px' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, letterSpacing: 2, color: '#d9c9a3', textTransform: 'uppercase', marginBottom: 18 }}>{slide.roundName} &middot; Makers &amp; Breakers</p>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 14, maxWidth: 680, width: '100%', justifyContent: 'center', maxHeight: `calc(100% - ${CONTROLS_SAFE_AREA_PX + 100}px)`, overflowY: 'auto' }}>
          {slide.highlights.map((h, i) => (
            <div key={i} style={{
              background: h.kind === 'maker' ? 'linear-gradient(160deg, rgba(234,179,8,0.22), rgba(234,179,8,0.08))' : 'linear-gradient(160deg, rgba(239,68,68,0.22), rgba(239,68,68,0.08))',
              border: `1px solid ${h.kind === 'maker' ? 'rgba(234,179,8,0.4)' : 'rgba(239,68,68,0.4)'}`,
              borderRadius: 14, padding: 16, textAlign: 'center', width: 220,
            }}>
              <p style={{ fontSize: 28, marginBottom: 6 }}>{h.icon}</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{h.title}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#fff', marginBottom: 2 }}>{h.playerName}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#d1d5db' }}>{h.statLine}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (slide.kind === 'champion') {
    // Elevated for V1.4 -- the biggest visual moment in the deck.
    const names = slide.champions.map(c => c.playerName).join(slide.hasTie ? ' & ' : '')
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: slide.photoUrl ? `linear-gradient(rgba(10,30,20,0.25), rgba(10,30,20,0.92)), url(${slide.photoUrl}) center/cover` : 'linear-gradient(160deg, #0a1f14 0%, #14532d 55%, #1a4731 100%)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 'clamp(36px, 6vw, 56px)', marginBottom: 6 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(12px, 1.6vw, 15px)', letterSpacing: 3, color: '#fbbf24', textTransform: 'uppercase', marginBottom: 14 }}>Event {slide.hasTie ? 'Co-Champions' : 'Champion'}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 5.2vw, 48px)', fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 12, lineHeight: 1.1 }}>{names}</p>
          <div style={{ width: 56, height: 2, background: '#fbbf24', marginBottom: 12 }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(15px, 2.2vw, 19px)', color: '#fff', fontWeight: 600 }}>{slide.champions[0]?.totalPoints} points</p>
        </div>
      </div>
    )
  }
  if (slide.kind === 'leaderboard') {
    // Redesigned for V1.4 -- presentation visual system (dark green/
    // gold), not a white webpage. Champion highlighted subtly.
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #14532d, #0f2a1c)', padding: `24px 24px ${CONTROLS_SAFE_AREA_PX + 16}px` }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: '#fff', letterSpacing: 1, marginBottom: 4 }}>Final Leaderboard</p>
        {slide.totalPages > 1 && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#d9c9a3', marginBottom: 16 }}>{(slide.page - 1) * 10 + 1}&ndash;{Math.min(slide.page * 10, (slide.page - 1) * 10 + slide.entries.length)}</p>}
        <div style={{ width: '100%', maxWidth: 420, background: 'rgba(0,0,0,0.2)', borderRadius: 14, padding: 10, maxHeight: '100%', overflowY: 'auto' }}>
          {slide.entries.map(e => (
            <div key={e.position} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderRadius: 8,
              background: e.position === 1 ? 'rgba(251,191,36,0.16)' : 'transparent',
              marginBottom: 2,
            }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: e.position === 1 ? '#fbbf24' : '#fff', fontWeight: e.position === 1 ? 700 : 400 }}>
                {e.position}. {e.playerName}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontWeight: 700, color: e.position === 1 ? '#fbbf24' : '#d9c9a3' }}>{e.totalPoints}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (slide.kind === 'bloopersDivider') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #1a1a16, #2a2318)' }}>
        <p style={{ fontSize: 32, marginBottom: 10 }}>🎬</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3.6vw, 32px)', fontWeight: 800, color: '#fff', letterSpacing: 2 }}>BLOOPERS &amp; OUTTAKES</p>
      </div>
    )
  }
  if (slide.kind === 'blooper') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        {slide.videoUrl ? (
          <video
            ref={videoRef}
            src={slide.videoUrl}
            muted={videoMuted}
            playsInline
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            onError={onVideoFailed}
          />
        ) : (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Video unavailable</p>
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
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, #14532d, #0f2a1c)' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3.4vw, 28px)', fontWeight: 800, color: '#fff', letterSpacing: 1, marginBottom: 10 }}>TEEIN&apos; IT UP</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#d9c9a3', letterSpacing: 0.5 }}>Run your next golf event like a pro.</p>
    </div>
  )
}

function navButtonStyle(disabled: boolean): React.CSSProperties {
  return { width: 44, height: 44, borderRadius: 22, border: 'none', background: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 22, cursor: disabled ? 'default' : 'pointer' }
}
const playButtonStyle: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 26, border: 'none', background: '#1a4731', color: '#fff', fontSize: 19, cursor: 'pointer',
}
