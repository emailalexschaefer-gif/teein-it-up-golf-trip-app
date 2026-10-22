'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import EventHighlightsPlayer from '@/components/memories/EventHighlightsPlayer'
import type { Slide } from '@/lib/trips/slideshowDeck'

// Release 3S -- landing screen + the EXISTING highlights player, used for both
// the public link and the member (event-only) view. The two contexts differ
// only in the slides/media they are given by the server.
interface Props {
  slides: Slide[]
  durationSeconds: 5 | 8 | 10
  aftershowStartIndex?: number
  aftershowLoop?: boolean
  eventName: string
  mode: 'public' | 'member'
  backHref?: string
}

const gold = '#c9a84c'
const green = '#0f2d1c'

export default function SharedPresentationViewer({ slides, durationSeconds, aftershowStartIndex, aftershowLoop, eventName, mode, backHref }: Props) {
  const [playing, setPlaying] = useState(false)
  const [finishedOnce, setFinishedOnce] = useState(false)

  if (playing) {
    return (
      <EventHighlightsPlayer
        slides={slides}
        durationSeconds={durationSeconds}
        aftershowStartIndex={aftershowStartIndex}
        aftershowLoop={aftershowLoop}
        onExit={() => { setPlaying(false); setFinishedOnce(true) }}
      />
    )
  }

  return (
    <main style={{ minHeight: '100dvh', background: green, color: '#faf6ed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', textAlign: 'center' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-new-720.png" alt="Teein' It Up" width={160} height={160} style={{ width: 160, height: 'auto', marginBottom: 24 }} />
      <p style={{ color: gold, letterSpacing: 2, fontSize: 12, textTransform: 'uppercase', margin: 0 }}>Event Presentation</p>
      <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 30, lineHeight: 1.15, margin: '10px 0 8px' }}>{eventName}</h1>
      <p style={{ opacity: 0.85, margin: '0 0 28px', maxWidth: 340 }}>Relive the highlights, winners, laughs and unforgettable Moments.</p>
      <button
        onClick={() => setPlaying(true)}
        style={{ minHeight: 56, minWidth: 220, borderRadius: 14, border: 'none', background: gold, color: green, fontSize: 18, fontWeight: 700, cursor: 'pointer' }}
      >
        {finishedOnce ? '▶ Watch again' : '▶ Watch Presentation'}
      </button>
      {mode === 'member' && backHref && (
        <Link href={backHref} style={{ color: gold, marginTop: 24, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Back</Link>
      )}
      {mode === 'public' && (
        <div style={{ marginTop: 40, opacity: finishedOnce ? 1 : 0.7 }}>
          <p style={{ margin: '0 0 8px' }}>Run your next golf event like a pro.</p>
          <Link href="/" style={{ color: gold, textDecoration: 'underline', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Find out more about Teein&rsquo; It Up</Link>
        </div>
      )}
    </main>
  )
}
