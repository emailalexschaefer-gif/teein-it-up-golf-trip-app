'use client'

/**
 * My HQ V2 (10 Oct), Phase C — "Event Progress: N of M rounds closed,"
 * per the approved brief (§2/point 2): determined exclusively by
 * officially completed rounds, fully independent of every round's own
 * Stage 4 (Makers & Breakers)/Stage 5 (Review & Present) status. Lives
 * beside Event Schedule, above the per-round Guided Workflow — this is
 * the event-wide signal, never to be confused with any one round's
 * five-stage progress.
 *
 * Deliberately a dumb display component: the caller (built from
 * deriveEventProgress() in src/lib/scoring/roundWorkflow.ts) passes
 * the already-computed counts; this never touches round.status itself
 * or any Makers & Breakers/presentation field.
 */
export default function EventProgressBadge({
  closedCount, totalCount,
}: {
  closedCount: number
  totalCount: number
}) {
  if (totalCount === 0) return null
  const allClosed = closedCount === totalCount

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: allClosed ? '#f0fdf4' : '#ffffff',
        border: `1px solid ${allClosed ? '#bbf7d0' : '#eceae3'}`,
        borderRadius: 10, padding: '8px 12px', marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 15 }}>{allClosed ? '🏆' : '⛳'}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: allClosed ? '#166534' : '#4a4638' }}>
        {allClosed ? 'Event Complete' : 'Event Progress'}: {closedCount} of {totalCount} round{totalCount === 1 ? '' : 's'} closed
      </span>
    </div>
  )
}
