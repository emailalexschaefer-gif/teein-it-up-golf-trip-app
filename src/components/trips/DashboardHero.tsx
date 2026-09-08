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
          Run your golf event<br />
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

        {/* Trip -> Event terminology migration (7 Sep), revised 8 Sep --
            item 1 of the 8 Sep field-test package: the device result
            showed these two buttons still stacking, one per row, on a
            real phone width. Root cause: flexWrap:'wrap' with each
            button sized to its own natural content width (fixed
            padding, no flex-basis) -- on a ~360-400px viewport, the
            combined natural width of both buttons' text genuinely
            exceeded the row, so the wrap fired every time, not just on
            a "genuinely too narrow" edge case. Fixed by giving each
            button flex:1 (they now share the row's width equally and
            shrink together, rather than each claiming its own natural
            width and wrapping when they don't both fit) and removing
            flexWrap entirely -- flex:1 items don't need a wrap
            fallback; they simply get narrower together instead of
            overflowing to a second line. minWidth:0 is the actual
            enabler for that shrinking (a flex item's default min-width
            is its content's natural width, which would otherwise
            silently defeat flex:1 and force the wrap anyway).
            justifyContent:'center' keeps each button's own label
            centred once it's no longer sized to its natural content
            width. */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/trips/new"
            className="active:scale-95 transition-transform"
            style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'linear-gradient(135deg, #c9a84c 0%, #e8c96a 50%, #c9a84c 100%)',
              color: '#0f2d1c',
              borderRadius: 12,
              padding: '13px 10px',
              fontFamily: 'var(--font-body)',
              fontSize: 13.5, fontWeight: 800,
              letterSpacing: 0.3,
              boxShadow: '0 4px 18px rgba(201,168,76,0.5)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + Create Event
          </Link>
          <Link
            href="/practice/new"
            className="active:scale-95 transition-transform"
            style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'transparent',
              color: '#f5e6b8',
              border: '1.5px solid rgba(245,230,184,0.45)',
              borderRadius: 12,
              padding: '13px 10px',
              fontFamily: 'var(--font-body)',
              fontSize: 13.5, fontWeight: 800,
              letterSpacing: 0.3,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            ⛳ Practice Round
          </Link>
        </div>
        {/* "Then underneath, separately: Join an Event" -- per the
            explicit brief. JoinByCode is already mounted as its own,
            separate section on the dashboard page (below this hero),
            not inside it -- confirmed the existing page structure
            already matches this requirement; nothing to change here. */}
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
