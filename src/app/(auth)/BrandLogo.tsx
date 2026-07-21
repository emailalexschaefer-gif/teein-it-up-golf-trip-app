'use client'

import React, { useState } from 'react'

// Client component — needed for onError and useState fallback.
// Auth layout stays a Server Component.

export default function BrandLogo() {
  const [failed, setFailed] = useState(false)

  if (failed) {
    // Graceful fallback — styled text logo if image can't load
    return (
      <div style={{
        width: 140, height: 140, margin: '0 auto 12px',
        background: 'linear-gradient(160deg, #1a4731 0%, #0f2d1c 100%)',
        border: '3px solid #c9a84c',
        borderRadius: 28,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 48 }}>⛳</span>
        <span style={{
          fontFamily: 'Georgia, serif', color: '#e8c96a',
          fontSize: 13, fontWeight: 700, marginTop: 4,
        }}>Teein&apos; It Up</span>
      </div>
    )
  }

  return (
    <div style={{
      width: 160, height: 160,
      margin: '0 auto 12px',
      // No filter — was hiding the image on some devices
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-full.png"
        alt="Teein' It Up"
        width={160}
        height={160}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
