'use client'

// Client component — needed for onError fallback.
// Auth layout stays a Server Component.

import React from 'react'

export default function BrandLogo() {
  return (
    <div style={{ width: 220, height: 220, margin: '0 auto 8px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-full.png"
        alt="Teein' It Up — Golf Event App"
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  )
}
