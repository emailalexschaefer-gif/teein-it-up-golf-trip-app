'use client'

import { useState } from 'react'
import MakersBreakers from './MakersBreakers'

/**
 * Package 4, item 11 — "field testing proved that hiding it somewhere
 * in Tournament Control is not sufficient." Traced the actual root
 * cause: the previous "Review Highlights" prompt only ever existed as
 * ephemeral client state (showMakersBreakers, set true only inside
 * TournamentControl's own handleClose success callback) — the moment
 * the organiser navigated away or refreshed, that state was gone
 * permanently, with no way back to it for an already-completed round.
 * This component lives at the parent page level instead (rendered
 * whenever focusRound is genuinely completed, per the Package 4 fix to
 * focusRound's own priority order), so it's reachable any time the
 * organiser looks at My HQ for that round — not just in the few
 * seconds right after closing it.
 *
 * Reuses the existing MakersBreakers component entirely — no second
 * highlight-generation UI, no duplicated presentation logic.
 */
export default function RoundHighlightsCard({
  tripId, roundId, roundName,
}: { tripId: string; roundId: string; roundName: string }) {
  const [open, setOpen] = useState(false)

  if (open) {
    return <MakersBreakers tripId={tripId} roundId={roundId} onProceedToResults={() => setOpen(false)} />
  }

  return (
    <button
      onClick={() => setOpen(true)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)', border: '1px solid rgba(232,201,106,0.3)',
        borderRadius: 14, padding: '14px 16px', marginBottom: 14,
      }}
    >
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#e8c96a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        🎭 {roundName} Highlights
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>
        Makers &amp; Breakers
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#e8c96a', marginTop: 6 }}>
        Review Highlights →
      </div>
    </button>
  )
}
