'use client'

import React from 'react'

// Premium hero section for the dashboard.
// Atmosphere: Masters green, gold accents, Playfair Display headline.
// The hero communicates confidence and excitement before the organiser begins.

export default function DashboardHero() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl animate-fadeUp"
      style={{
        background: 'linear-gradient(160deg, #0f2d1c 0%, #1a4731 55%, #236040 100%)',
        border: '1.5px solid rgba(201,168,76,0.35)',
        boxShadow: '0 4px 24px rgba(15,45,28,0.35)',
        padding: '24px 22px 22px',
      }}
    >
      {/* Decorative background texture — subtle fairway lines */}
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
        {/* Headline */}
        <h1 style={{
          fontFamily: 'var(--font-display)',
          color: '#ffffff',
          fontSize: 26, fontWeight: 800,
          lineHeight: 1.15, letterSpacing: -0.3,
          marginBottom: 4,
        }}>
          Run your next<br />
          <span style={{ color: '#e8c96a' }}>golf event like a pro</span>
        </h1>

        {/* Subtitle */}
        <p style={{
          fontFamily: 'var(--font-body)',
          color: 'rgba(245,230,184,0.65)',
          fontSize: 13, lineHeight: 1.5,
          marginBottom: 18,
        }}>
          No admin chaos. Just great golf experiences.
        </p>

        {/* Primary CTA */}
        <a
          href="/trips/new"
          className="inline-flex items-center gap-2 active:scale-95 transition-transform"
          style={{
            background: 'linear-gradient(135deg, #c9a84c 0%, #e8c96a 50%, #c9a84c 100%)',
            color: '#0f2d1c',
            borderRadius: 12,
            padding: '12px 22px',
            fontFamily: 'var(--font-body)',
            fontSize: 14, fontWeight: 800,
            letterSpacing: 0.5,
            boxShadow: '0 4px 18px rgba(201,168,76,0.45)',
            textDecoration: 'none',
            display: 'inline-flex',
          }}
        >
          <span style={{ fontSize: 16 }}>📅</span>
          Create Event
        </a>
      </div>

      {/* Decorative gold diamond */}
      <div style={{
        position: 'absolute', bottom: 18, right: 20,
        opacity: 0.12,
        fontFamily: 'var(--font-display)',
        fontSize: 72, color: '#c9a84c',
        lineHeight: 1, userSelect: 'none',
        pointerEvents: 'none',
      }}>
        ⛳
      </div>
    </div>
  )
}
