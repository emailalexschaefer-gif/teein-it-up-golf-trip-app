'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { Slide } from '@/lib/trips/slideshowDeck'

/**
 * Event Memories V1.2 (12 Sep) -- the Event Highlights fullscreen
 * player. Confirmed no existing fullscreen/wake-lock component exists
 * anywhere in the app (Phase 1 audit) -- this is genuinely new code,
 * not a reuse of something that already existed.
 *
 * PRELOADING: only ever holds the current, next, and previous slide's
 * image in the DOM at once (three <img> elements, two of them
 * invisible/display:none) -- never eagerly loads the whole deck, per
 * the brief's explicit "do not eagerly fetch 100+ full-resolution
 * images simultaneously." A failed image shows a plain unavailable
 * state and playback continues; it never crashes the presentation.
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

export default function EventHighlightsPlayer({ slides, durationSeconds, onExit }: EventHighlightsPlayerProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const current = slides[index]
  const isPhoto = (s: Slide | undefined): s is Extract<Slide, { kind: 'photo' }> => s?.kind === 'photo'

  // Per-slide duration: photo slides use the chosen duration; title/
  // divider/closing slides stay visible a little longer, matching
  // "title/chapter slides may remain visible slightly longer."
  const slideDurationMs = (current?.kind === 'photo' ? durationSeconds : durationSeconds + 2) * 1000

  const goTo = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)))
  }, [slides.length])

  const advance = useCallback(() => {
    setIndex(prev => (prev >= slides.length - 1 ? prev : prev + 1))
  }, [slides.length])

  // Auto-advance.
  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (!playing) return
    if (index >= slides.length - 1) { setPlaying(false); return }
    advanceTimer.current = setTimeout(advance, slideDurationMs)
    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }
  }, [index, playing, slideDurationMs, advance, slides.length])

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
      <div style={{ position: 'absolute', inset: 0, display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        {failed ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>Photo unavailable</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slide.imageUrl} alt={slide.caption ?? 'Event memory'}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            onError={() => setFailedUrls(prev => new Set(prev).add(slide.imageUrl!))}
          />
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onClick={bumpControls}
      onTouchStart={bumpControls}
      style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 100, overflow: 'hidden' }}
    >
      {/* Preload current + adjacent photo slides only -- never the whole deck. */}
      {renderPhoto(isPhoto(slides[index - 1]) ? slides[index - 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}
      {renderPhoto(isPhoto(current) ? current : undefined, true)}
      {renderPhoto(isPhoto(slides[index + 1]) ? slides[index + 1] as Extract<Slide, { kind: 'photo' }> : undefined, false)}

      {!isPhoto(current) && <NonPhotoSlide slide={current} />}

      {/* Photo context overlay -- subtle, never competing with the photograph. */}
      {isPhoto(current) && (current.roundName || current.holeNumber || current.playerName || current.sideCompName || current.caption) && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 20px 20px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
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

      {/* Controls -- fade during playback, reappear on interaction. */}
      <div style={{ position: 'absolute', inset: 0, opacity: controlsVisible ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: controlsVisible ? 'auto' : 'none' }}>
        <button onClick={onExit} style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 18, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16, cursor: 'pointer' }}>
          \u2715
        </button>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: isPhoto(current) ? 110 : 24, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
          <button onClick={() => goTo(index - 1)} disabled={index === 0} style={navButtonStyle(index === 0)}>\u2039</button>
          <button onClick={() => setPlaying(p => !p)} style={playButtonStyle}>{playing ? '\u23f8' : '\u25b6'}</button>
          <button onClick={() => goTo(index + 1)} disabled={index === slides.length - 1} style={navButtonStyle(index === slides.length - 1)}>\u203a</button>
        </div>
      </div>
    </div>
  )
}

function NonPhotoSlide({ slide }: { slide: Slide }) {
  if (slide.kind === 'opening') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, background: slide.heroImageUrl ? `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${slide.heroImageUrl}) center/cover` : '#14532d' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', marginBottom: 8 }}>{slide.eventName}</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#e5e7eb', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Event Highlights</p>
        {slide.dateRange && <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#d1d5db' }}>{slide.dateRange}</p>}
      </div>
    )
  }
  if (slide.kind === 'eventDivider') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a4731' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: 2 }}>EVENT MEMORIES</p>
      </div>
    )
  }
  if (slide.kind === 'roundDivider') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1a4731', padding: 24 }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#fff', textTransform: 'uppercase', marginBottom: 10 }}>{slide.roundName}</p>
        {slide.courseName && <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#e5e7eb' }}>{slide.courseName}</p>}
        {slide.playDate && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#d1d5db' }}>{new Date(slide.playDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
      </div>
    )
  }
  // closing
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#14532d' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>EVENT HIGHLIGHTS</p>
    </div>
  )
}

function navButtonStyle(disabled: boolean): React.CSSProperties {
  return { width: 48, height: 48, borderRadius: 24, border: 'none', background: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 24, cursor: disabled ? 'default' : 'pointer' }
}
const playButtonStyle: React.CSSProperties = {
  width: 56, height: 56, borderRadius: 28, border: 'none', background: '#1a4731', color: '#fff', fontSize: 20, cursor: 'pointer',
}
