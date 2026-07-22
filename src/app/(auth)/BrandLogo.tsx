'use client'

// Extracted as a Client Component so it can live inside a Server Component layout.
// Uses next/image for correct path resolution from /public in all environments.

import Image from 'next/image'

export default function BrandLogo() {
  return (
    <div style={{ width: 220, height: 220, margin: '0 auto 8px', position: 'relative' }}>
      <Image
        src="/logo-full.png"
        alt="Teein' It Up — Golf Event App"
        fill
        priority
        style={{ objectFit: 'contain' }}
      />
    </div>
  )
}
