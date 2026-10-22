'use client'

import { useEffect, useState } from 'react'

// Champion-reveal confetti: a shower lasting as long as the applause (9-10 s). Skipped entirely under prefers-reduced-motion. Decorative only
// (aria-hidden, pointer-events none) so it never blocks the presentation's
// controls. Mount it with a fresh `key` for each deliberate (re)play.
const COLORS = ['#c9a84c', '#e8c96a', '#f5e6b8', '#14532d', '#1a6b3a', '#ffffff']
const PIECES = 70
const FALL_MIN_MS = 2400
const FALL_MAX_MS = 3400

interface Piece { id: number; left: number; delay: number; duration: number; rotate: number; color: string; size: number; drift: number }

/** Pieces start building over the first part of the celebration and every piece has landed by `totalMs`. */
export function buildConfettiPieces(totalMs: number, rand: () => number = Math.random): Piece[] {
  const spread = Math.max(0, totalMs - FALL_MAX_MS)
  return Array.from({ length: PIECES }, (_, i) => ({
    id: i, left: rand() * 100, delay: rand() * spread, duration: FALL_MIN_MS + rand() * (FALL_MAX_MS - FALL_MIN_MS),
    rotate: rand() * 360, color: COLORS[i % COLORS.length], size: 6 + rand() * 6, drift: (rand() - 0.5) * 120,
  }))
}

/** Reduced-motion viewers get no animated confetti at all. */
export function confettiPieces(totalMs: number, prefersReducedMotion: boolean, rand: () => number = Math.random): Piece[] {
  return prefersReducedMotion ? [] : buildConfettiPieces(totalMs, rand)
}

export default function PresentationConfetti({ durationMs }: { durationMs: number }) {
  const [pieces] = useState<Piece[]>(() => {
    if (typeof window === 'undefined') return []
    return confettiPieces(durationMs, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  })
  const [done, setDone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDone(true), durationMs + 300)
    return () => clearTimeout(t)
  }, [durationMs])
  if (done || pieces.length === 0) return null
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      <style>{'@keyframes ttuConfettiFall { from { transform: translate3d(0,-10%,0) rotate(0deg); opacity: 1 } 85% { opacity: 1 } to { transform: translate3d(var(--drift),62cqw,0) rotate(720deg); opacity: 0 } }'}</style>
      {pieces.map(p => (
        <span key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.left}%`, width: p.size, height: p.size * 0.6, background: p.color, borderRadius: 1,
          transform: `rotate(${p.rotate}deg)`, ['--drift' as string]: `${p.drift}px`,
          animation: `ttuConfettiFall ${p.duration}ms ${p.delay}ms ease-in forwards`, opacity: 0,
        }} />
      ))}
    </div>
  )
}
