'use client'

import { useEffect, useState } from 'react'

/**
 * One tasteful confetti burst for the Final Event Results champion hero.
 *
 * Deliberately hand-rolled rather than an npm package — no confetti
 * library exists anywhere in this project already (checked package.json
 * and searched the codebase before writing this), and this is a small,
 * self-contained, dependency-free CSS animation rather than a canvas/
 * physics library, so nothing new needed adding to package.json for a
 * one-time visual effect. Flagging this choice explicitly per the "don't
 * introduce a large dependency without reporting it first" instruction —
 * happy to swap to a library instead if preferred, but this keeps the
 * bundle and the review surface small.
 *
 * Plays once per mount only (not on every re-render — the person landing
 * on My HQ, tapping around, and the parent re-rendering for unrelated
 * reasons must not keep re-triggering it): the piece list is generated
 * once in a lazy useState initializer, and the CSS animation itself has
 * a fixed, finite duration with fill-mode: forwards, so it runs once and
 * stops rather than looping. Reopening the results page is a fresh mount
 * and will play again — an explicitly acceptable behaviour per the brief
 * ("may replay when deliberately reopening the page").
 *
 * Respects prefers-reduced-motion: skips the animation entirely rather
 * than a reduced version, since a confetti burst has no essential
 * information to convey — someone who's asked for reduced motion loses
 * nothing by not seeing it.
 *
 * pointer-events: none throughout, so it can never sit on top of and
 * block a tap on the page's real navigation underneath it.
 */
const COLORS = ['#c9a84c', '#14532d', '#e8c96a', '#1a6b3a', '#f5e6b8']
const PIECE_COUNT = 26

interface Piece { id: number; left: number; delay: number; duration: number; rotate: number; color: string; size: number }

function buildPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.6 + Math.random() * 0.9,
    rotate: Math.random() * 360,
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 5,
  }))
}

export default function ConfettiBurst() {
  const [pieces] = useState<Piece[]>(() => {
    if (typeof window === 'undefined') return []
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return []
    return buildPieces()
  })
  // Removes the pieces from the DOM once the longest possible animation
  // has definitely finished, rather than leaving ~26 finished-animation
  // nodes sitting around indefinitely — small cleanup, not required for
  // correctness (fill-mode: forwards already holds them invisible/faded
  // at the end), but keeps the DOM tidy on a page people may stay on.
  const [visible, setVisible] = useState(pieces.length > 0)
  useEffect(() => {
    if (pieces.length === 0) return
    const t = setTimeout(() => setVisible(false), 3000)
    return () => clearTimeout(t)
  }, [pieces.length])

  if (!visible || pieces.length === 0) return null

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(160px) rotate(360deg); opacity: 0; }
        }
      `}</style>
      {pieces.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute', top: 0, left: `${p.left}%`,
            width: p.size, height: p.size * 0.55, background: p.color,
            borderRadius: 1.5,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
