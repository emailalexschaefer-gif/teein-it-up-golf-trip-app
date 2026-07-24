'use client'

import React from 'react'
import Link from 'next/link'

export default function DashboardHero() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl animate-fadeUp"
      style={{
        background: 'linear-gradient(160deg, #0f2d1c 0%, #1a4731 55%, #236040 100%)',
        border: '1.5px solid rgba(201,168,76,0.35)',
        boxShadow: '0 6px 32px rgba(15,45,28,0.4)',
        padding: '30px 24px 26px',
        minHeight: 180,
      }}
    >
      {/* Subtle fairway-line texture */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'repeating-linear-gradient(0deg, #c9a84c 0px, #c9a84c 1px, transparent 1px, transparent 32px)',
        pointerEvents: 'none',
      }} />

      {/* Gold rule at top */}
      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 1,
        background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)',
      }} />

      <div className="relative">
        {/* Headline — larger, product language */}
        <h1 style={{
          fontFamily: 'var(--font-display)',
          color: '#ffffff',
          fontSize: 30, fontWeight: 800,
          lineHeight: 1.1, letterSpacing: -0.5,
          marginBottom: 6,
        }}>
          Run your golf trip<br />
          <span style={{ color: '#e8c96a' }}>like a pro</span>
        </h1>

        {/* Subtitle */}
        <p style={{
          fontFamily: 'var(--font-body)',
          color: 'rgba(245,230,184,0.6)',
          fontSize: 13.5, lineHeight: 1.5,
          marginBottom: 22,
        }}>
          No admin chaos. Just great experiences.
        </p>

        {/* Primary CTA — "Create Trip" not "Create Event" */}
        <Link
          href="/trips/new"
          className="inline-flex items-center gap-2 active:scale-95 transition-transform"
          style={{
            background: 'linear-gradient(135deg, #c9a84c 0%, #e8c96a 50%, #c9a84c 100%)',
            color: '#0f2d1c',
            borderRadius: 12,
            padding: '13px 24px',
            fontFamily: 'var(--font-body)',
            fontSize: 14.5, fontWeight: 800,
            letterSpacing: 0.6,
            boxShadow: '0 4px 18px rgba(201,168,76,0.5)',
            textDecoration: 'none',
          }}
        >
          + Create Trip
        </Link>
      </div>

      {/* Watermark */}
      <div style={{
        position: 'absolute', bottom: 16, right: 20,
        opacity: 0.1, fontSize: 80, lineHeight: 1,
        userSelect: 'none', pointerEvents: 'none',
      }}>
        ⛳
      </div>
    </div>
  )
}
