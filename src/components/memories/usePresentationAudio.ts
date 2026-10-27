'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PresentationAudioController, type AudioState } from '@/lib/presentation/audioController'
import { createBrowserChannel } from '@/lib/presentation/audioChannel'
import { APPLAUSE_SRC, CONFETTI_MAX_MS, CONFETTI_MIN_MS, FADE_IN_MS, FADE_OUT_MS, FALLBACK_CELEBRATION_MS, MUSIC_PREF_KEY, MUSIC_SRC, MUSIC_VOLUME, REVEAL_DELAY_MS } from '@/lib/presentation/audioConfig'

// One controller per mounted player. Created in an effect (never during
// render / SSR); disposed on unmount so nothing keeps playing after the
// presentation closes. The music on/off preference lives in sessionStorage,
// i.e. for this presentation session only.
// 27 Oct: background music is OFF by default. It plays only after the viewer switches it on (that choice is then kept for the session).
function readMusicPref(): boolean {
  try { return window.sessionStorage.getItem(MUSIC_PREF_KEY) === 'on' } catch { return false }
}
function writeMusicPref(on: boolean) {
  try { window.sessionStorage.setItem(MUSIC_PREF_KEY, on ? 'on' : 'off') } catch { /* private mode: preference just isn't remembered */ }
}

const INITIAL: AudioState = { musicEnabled: false, applauseEnabled: true, blocked: false, applauseAvailable: false }

export function usePresentationAudio() {
  const ref = useRef<PresentationAudioController | null>(null)
  const [state, setState] = useState<AudioState>(INITIAL)
  // run 0 = no confetti; otherwise a fresh key for each reveal so a revisit replays it. ms = how long it lasts.
  const [confetti, setConfetti] = useState({ run: 0, ms: 0 })

  useEffect(() => {
    const music = createBrowserChannel(MUSIC_SRC, { useGain: true })
    const applause = APPLAUSE_SRC ? createBrowserChannel(APPLAUSE_SRC, { useGain: false }) : null
    const controller = new PresentationAudioController({
      music, applause, musicVolume: MUSIC_VOLUME, fadeOutMs: FADE_OUT_MS, fadeInMs: FADE_IN_MS, revealDelayMs: REVEAL_DELAY_MS,
      fallbackCelebrationMs: FALLBACK_CELEBRATION_MS, confettiMinMs: CONFETTI_MIN_MS, confettiMaxMs: CONFETTI_MAX_MS,
      musicEnabled: readMusicPref(),
      onReveal: ms => setConfetti(c => ({ run: c.run + 1, ms })),
      scheduler: {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: h => window.clearTimeout(h as number),
        setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: h => window.clearInterval(h as number),
      },
    })
    ref.current = controller
    const unsub = controller.subscribe(setState)
    setState(controller.getState())
    void controller.start() // the player is mounted by the viewer's own tap on Play/Watch
    return () => { unsub(); controller.dispose(); ref.current = null }
  }, [])

  const toggleMusic = useCallback(() => {
    const c = ref.current
    if (!c) return
    const next = !c.getState().musicEnabled
    writeMusicPref(next)
    c.setMusicEnabled(next)
    if (next) void c.unlock()
  }, [])
  const toggleApplause = useCallback(() => {
    const c = ref.current
    if (c) c.setApplauseEnabled(!c.getState().applauseEnabled)
  }, [])
  const unlock = useCallback(() => { void ref.current?.unlock() }, [])
  const setVideoPlaying = useCallback((on: boolean) => { ref.current?.setVideoPlaying(on) }, [])
  const celebrate = useCallback(() => { ref.current?.celebrate() }, [])
  const endCelebration = useCallback(() => { ref.current?.endCelebration(); setConfetti(c => ({ run: 0, ms: c.ms })) }, [])

  return { confetti, state, toggleMusic, toggleApplause, unlock, setVideoPlaying, celebrate, endCelebration }
}
