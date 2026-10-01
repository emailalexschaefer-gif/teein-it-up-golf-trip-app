'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

/**
 * Event Memories V1 follow-up (10 Sep) -- the My HQ entry point the
 * original spec called for ("📸 Event Memories -- 84 photos -- View
 * all →"), found missing from the delivered files during review. A
 * simple, always-visible navigation card -- not a CollapsibleSection
 * with expandable content, since there is nothing to expand here; the
 * gallery itself lives at its own route. Deliberately placed after The
 * Story (the last existing section) rather than inserted among the
 * Live Event control sections above it, so it never competes for
 * attention with round-control actions during an active round, per
 * the explicit "without disturbing Live Event controls" instruction.
 */
export default function EventMemoriesCard({ tripId }: { tripId: string }) {
  const { data } = useQuery<{ photoCount: number; roundsWithMemories: number }>({
    queryKey: ['memories-count', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/memories/count`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    staleTime: 30000,
  })

  const photoCount = data?.photoCount ?? 0

  return (
    <Link
      href={`/trips/${tripId}/memories`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 16px',
        textDecoration: 'none', marginTop: 16,
      }}
    >
      <div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>
          📸 Event Memories
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260', marginTop: 2 }}>
          {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'No photos yet'}
        </div>
      </div>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#a1791f' }}>
        View all →
      </span>
    </Link>
  )
}
