'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

// Release 3S -- "Watch Event Presentation" for My Golf. Renders nothing until
// the organiser has published one; reads the stored snapshot's status only
// (one light request, no polling), so it never touches scoring data.
export default function WatchPresentationLink({ tripId }: { tripId: string }) {
  const { data } = useQuery<{ published: boolean }>({
    queryKey: ['share-presentation-status', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/share-presentation`, { cache: 'no-store' })
      if (!res.ok) return { published: false }
      return res.json()
    },
    staleTime: 0,
  })
  if (!data?.published) return null
  return (
    <Link
      href={`/trips/${tripId}/presentation`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, margin: '0 0 16px', borderRadius: 12, background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
    >
      <span aria-hidden="true">{'▶'}</span> Watch Event Presentation
    </Link>
  )
}
