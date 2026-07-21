'use client'

import React, { useState } from 'react'

export default function BrandLogo() {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div style={{
        width: 200, height: 200, margin: '0 auto 12px',
        background: 'linear-gradient(160deg, #1a4731 0%, #0f2d1c 100%)',
        border: '3px solid #c9a84c',
        borderRadius: 20,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 64 }}>🏌️</span>
        <span style={{
          fontFamily: 'Georgia, serif', color: '#e8c96a',
          fontSize: 18, fontWeight: 800, textAlign: 'center',
          lineHeight: 1.2,
        }}>Teein&apos; It Up</span>
        <span style={{
          fontFamily: 'sans-serif', color: 'rgba(232,201,106,0.5)',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
        }}>Golf Event App</span>
      </div>
    )
  }

  return (
    <div style={{ width: 200, height: 200, margin: '0 auto 12px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-full.png"
        alt="Teein' It Up"
        style={{
          width: '100%', height: '100%',
          objectFit: 'contain', display: 'block',
        }}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
