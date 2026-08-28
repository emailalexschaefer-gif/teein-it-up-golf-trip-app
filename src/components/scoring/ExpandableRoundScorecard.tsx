import type { CaptureValue } from '@/lib/scoring/comparison'
import { calculateStableford } from '@/lib/scoring/stableford'

interface Hole {
  id: string; hole_number: number; par: number; stroke_index: number
}

/**
 * Follow-up UX pass — extracted verbatim from SelfMarkerScoreShell's
 * previously inline "View Round Scorecard" block (same tile sizing,
 * same front/back split, same stripPtsBackground/stripPtsColor colour
 * bands, same current-hole highlight), turned into a genuine reusable
 * component so shared-device mode can mount it twice — once for the
 * digital player, once for the paper player — without a second visual
 * implementation. Every prop here is exactly the data
 * SelfMarkerScoreShell already had in scope for its own single
 * instance; nothing new is computed, only passed in from whichever
 * player's own state (mySelf/myHcp or partnerSelf/partnerHcp) applies.
 *
 * Deliberately does NOT own its own expand/collapse state — the parent
 * shell owns two independent boolean states (one per player) and
 * passes `expanded`/`onToggle` down, which is what makes the two
 * instances genuinely independently expandable rather than sharing a
 * single toggle.
 */
export default function ExpandableRoundScorecard({
  label, holes, holeIdx, onSelectHole, captureByHole, playingHandicap,
  powerplayHoleNumbers, sideCompHoleNumbers, expanded, onToggle, footerNote,
}: {
  label: string
  holes: Hole[]
  holeIdx: number
  onSelectHole: (idx: number) => void
  captureByHole: Record<number, CaptureValue | undefined>
  playingHandicap: number
  powerplayHoleNumbers: Set<number>
  sideCompHoleNumbers: Set<number>
  expanded: boolean
  onToggle: () => void
  footerNote?: string | null
}) {
  function stripPtsColor(pts: number): string {
    if (pts >= 4) return '#854d0e'
    if (pts === 3) return '#14532d'
    if (pts === 2) return '#1e3a5f'
    return '#57503f'
  }
  function stripPtsBackground(pts: number): string {
    if (pts >= 4) return '#fef9c3'
    if (pts === 3) return '#dcfce7'
    if (pts === 2) return '#dbeafe'
    return '#f3f4f6'
  }

  const front9 = holes.filter(h => h.hole_number <= 9)
  const back9 = holes.filter(h => h.hole_number > 9)
  const front9Pts = front9.reduce((s, h) => {
    const c = captureByHole[h.hole_number]
    if (!c || c.pickedUp || c.grossScore === null) return s
    return s + calculateStableford({ grossScore: c.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
  }, 0)
  const front9Done = front9.every(h => {
    const c = captureByHole[h.hole_number]
    return !!c && (c.pickedUp || c.grossScore !== null)
  })

  function renderTile(h: Hole, idx: number) {
    const c = captureByHole[h.hole_number]
    const isCurrent = idx === holeIdx
    const hasScore = c && (c.pickedUp || c.grossScore !== null)
    const pts = hasScore && !c!.pickedUp && c!.grossScore !== null
      ? calculateStableford({ grossScore: c!.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
      : null
    const bg = isCurrent ? '#16a34a' : hasScore ? (pts !== null ? stripPtsBackground(pts) : '#fdf3d9') : '#f3f4f6'
    const fg = isCurrent ? '#fff' : hasScore ? (pts !== null ? stripPtsColor(pts) : '#7a5c00') : '#52525b'
    const hasSideComp = sideCompHoleNumbers.has(h.hole_number)
    const isPowerplay = powerplayHoleNumbers.has(h.hole_number)
    return (
      <button
        key={h.id}
        onClick={() => onSelectHole(idx)}
        style={{
          flex: '1 1 0', minWidth: 0, height: 36, borderRadius: 6, cursor: 'pointer',
          background: bg, border: `1.5px solid ${isCurrent ? '#14532d' : '#9c9585'}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transform: isCurrent ? 'scale(1.06)' : 'scale(1)', transition: 'transform 0.12s',
          padding: 0, position: 'relative',
        }}
      >
        {(hasSideComp || isPowerplay) && (
          <span style={{
            position: 'absolute', top: -5, right: -4, fontSize: 10, lineHeight: 1,
            filter: isCurrent ? 'none' : 'drop-shadow(0 0 1px rgba(255,255,255,0.9))',
          }}>
            {isPowerplay ? '⚡' : '⭐'}
          </span>
        )}
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: fg }}>{h.hole_number}</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 8, fontWeight: 600, color: fg }}>
          {c?.pickedUp ? 'P' : c?.grossScore ?? '–'}
        </span>
      </button>
    )
  }

  return (
    <div style={expanded ? { padding: '0 0 10px', borderBottom: '1px solid #c9c4b6', marginBottom: 12 } : undefined}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'center', padding: expanded ? '7px 0' : '3px 0', marginBottom: expanded ? 10 : 0,
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#8a6416',
        }}
      >
        {expanded ? `▲ Hide ${label}` : `▼ View ${label}`}
      </button>

      {expanded && (
        <>
          {front9.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: front9Done ? '#16a34a' : '#52525b', marginBottom: 4 }}>
                {front9Done ? `✓ FRONT 9 COMPLETE — ${front9Pts} PTS` : 'FRONT 9'}
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
                {front9.map((h) => renderTile(h, holes.indexOf(h)))}
              </div>
            </>
          )}
          {back9.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: '#52525b', marginBottom: 4 }}>
                BACK 9
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                {back9.map((h) => renderTile(h, holes.indexOf(h)))}
              </div>
            </>
          )}
        </>
      )}

      {expanded && footerNote && (
        <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 10, color: '#52525b', marginTop: 6 }}>
          {footerNote}
        </div>
      )}
    </div>
  )
}
