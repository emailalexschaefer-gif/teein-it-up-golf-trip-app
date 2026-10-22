'use client'

// Browser implementation of AudioChannel. Prefers a WebAudio GainNode for
// volume because iOS Safari ignores HTMLMediaElement.volume (it is read-only
// there); falls back to element.volume. Never autoplays by itself -- play() is
// only called by the controller after a user gesture, and a rejected play()
// is reported to the controller (it shows the "tap" fallback instead).
import type { AudioChannel } from './audioController'

type AudioContextCtor = typeof AudioContext
interface WindowWithWebkit { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }

let sharedContext: AudioContext | null = null
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (sharedContext) return sharedContext
  const w = window as unknown as WindowWithWebkit
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  try { sharedContext = new Ctor() } catch { return null }
  return sharedContext
}

export function createBrowserChannel(src: string, opts: { useGain: boolean }): AudioChannel {
  const el = new Audio()
  el.preload = 'auto'
  el.src = src
  let gain: GainNode | null = null
  let source: MediaElementAudioSourceNode | null = null
  let playingCb: (() => void) | null = null
  let disposed = false

  if (opts.useGain) {
    const ctx = getContext()
    if (ctx) {
      try {
        source = ctx.createMediaElementSource(el)
        gain = ctx.createGain()
        source.connect(gain)
        gain.connect(ctx.destination)
      } catch { gain = null; source = null }
    }
  }

  el.addEventListener('playing', () => { playingCb?.() })

  return {
    get playing() { return !el.paused && !el.ended },
    durationMs() { return Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : null },
    async play() {
      if (disposed) return
      const ctx = getContext()
      if (gain && ctx && ctx.state === 'suspended') await ctx.resume()
      await el.play()
    },
    pause() { el.pause() },
    rewind() { try { el.currentTime = 0 } catch { /* not seekable yet */ } },
    setVolume(v: number) {
      const clamped = Math.max(0, Math.min(1, v))
      if (gain) gain.gain.value = clamped
      else el.volume = clamped
    },
    setLoop(on: boolean) { el.loop = on },
    onPlaying(cb: () => void) { playingCb = cb },
    dispose() {
      disposed = true
      el.pause()
      el.removeAttribute('src')
      el.load()
      try { source?.disconnect(); gain?.disconnect() } catch { /* already disconnected */ }
      playingCb = null
    },
  }
}
