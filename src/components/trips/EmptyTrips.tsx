import React from 'react'
import Link from 'next/link'

// Full "no trips at all" empty state — distinct from TripList's per-tab
// (active/completed/archived) empty states, which stay inline in TripList
// itself. This is for a context with zero trips of any kind (e.g. a brand
// new account before their first trip exists).
//
// NOTE: this file did not exist in the working tree I had — it was listed
// as a failing file in the build log, so I've recreated it from that
// description (an `<a href="/trips/new/">` that needed to become `<Link>`).
// If your actual project version has different content or props, treat this
// as a reference implementation to diff against, not an assumed-correct
// drop-in replacement.

interface EmptyTripsProps {
  title?: string
  body?: string
}

export default function EmptyTrips({
  title = 'No trips yet',
  body = 'Create your first trip and start bringing people together through golf.',
}: EmptyTripsProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center animate-fadeIn">
      <span style={{ fontSize: 44, marginBottom: 12 }}>⛳</span>
      <h3 style={{
        fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700,
        color: '#1a1a16', marginBottom: 6,
      }}>{title}</h3>
      <p style={{
        fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260',
        maxWidth: 260, lineHeight: 1.55, marginBottom: 20,
      }}>{body}</p>
      <Link
        href="/trips/new"
        className="active:scale-95 transition-transform"
        style={{
          background: 'linear-gradient(160deg, #2d7a52 0%, #1a4731 100%)',
          color: '#ffffff',
          borderRadius: 12, padding: '11px 22px',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
          textDecoration: 'none',
          boxShadow: '0 4px 14px rgba(26,71,49,0.35)',
        }}
      >
        + Create your first event
      </Link>
    </div>
  )
}
