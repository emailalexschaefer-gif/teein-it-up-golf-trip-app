'use client'

// Offline Player Support, items 7-8, 12 — the paper-scorecard player's
// "Scorecard tab" experience. Never asked to Start Scoring, never shown
// digital pairing/reconciliation UI. Deliberately a plain status card,
// not a cut-down version of either scoring shell — reusing/trimming
// SelfMarkerScoreShell or ScoreSessionShell here would risk carrying
// over digital-only assumptions (marker relationships, hole-by-hole
// entry state) that don't apply to a paper player at all.
export default function PaperScorecardStatus({
  tripId, roundId, tripName, roundName, paperTotal,
}: {
  tripId: string; roundId: string; tripName: string; roundName: string
  // Item 12 — null means "organiser hasn't entered the card yet" (the
  // waiting state); a number (including 0) means the official score
  // already exists — "no action required from the paper player" to
  // move between these two states, since this is purely a read of
  // score_entries computed server-side in page.tsx, not something this
  // component polls or manages itself.
  paperTotal: number | null
}) {
  return (
    <div style={{ minHeight: '100dvh', background: '#faf6ed', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: 'linear-gradient(170deg, #0a1f10 0%, #0f2d1a 60%, #0e2516 100%)',
        padding: '16px 20px', color: '#fdf3d9',
      }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, opacity: 0.75, letterSpacing: 0.5 }}>{tripName}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>{roundName}</div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}>
        {paperTotal !== null ? (
          <>
            {/* Item 12 — the completed state. */}
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#14532d', marginBottom: 4 }}>
              Round Score Entered
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 900, color: '#a1791f', marginBottom: 16 }}>
              {paperTotal} pts
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#6b7280', maxWidth: 320, lineHeight: 1.6 }}>
              Your organiser has entered your official round score. Check the leaderboard to see how you did.
            </p>
          </>
        ) : (
          <>
            {/* Item 8 — the waiting state, exact copy from the brief. */}
            <div style={{ fontSize: 40, marginBottom: 8 }}>✏️</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#14532d', marginBottom: 12 }}>
              Paper Scorecard
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#374151', maxWidth: 320, lineHeight: 1.7 }}>
              You&apos;re playing this round using a physical scorecard.
              Have another golfer in your group check/sign your card.
              Your organiser will enter your final score after the round.
            </p>
          </>
        )}

        <a
          href={`/trips/${tripId}/leaderboard?roundId=${roundId}`}
          style={{
            marginTop: 24, padding: '11px 28px', borderRadius: 10, background: '#14532d', color: '#fff',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, textDecoration: 'none',
          }}
        >
          🏆 View Leaderboard
        </a>
      </div>
    </div>
  )
}
