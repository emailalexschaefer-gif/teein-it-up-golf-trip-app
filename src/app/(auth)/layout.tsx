import React from 'react'
import BrandLogo from '@/components/brand/BrandLogo'

// Auth layout: Masters-dark background, full brand logo, premium card.
// Logo is sized to occupy roughly the upper quarter-to-third of the panel
// on a typical mobile viewport, without overwhelming the form below it.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(170deg, #0a1f10 0%, #0f2d1a 36%, #0e2516 68%, #050e08 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px 40px',
    }}>
      {/* Full brand logo — larger and visually prominent per the landing-page requirement */}
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <BrandLogo variant="full" size={280} priority />
        <p style={{
          fontFamily: 'var(--font-body)',
          color: 'rgba(245,230,184,0.45)',
          fontSize: 10, marginTop: 2,
          letterSpacing: 2.5, textTransform: 'uppercase',
        }}>Golf Event App</p>
      </div>

      {/* Auth card */}
      <div style={{
        width: '100%', maxWidth: 360,
        background: '#f8f4eb',
        borderRadius: 18,
        border: '1.5px solid #d9c9a3',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8)',
        padding: '28px 24px',
      }}>
        {children}
      </div>

      {/* Tagline */}
      <p style={{
        marginTop: 20,
        fontFamily: 'var(--font-body)',
        color: 'rgba(245,230,184,0.25)',
        fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
      }}>
        No admin chaos. Just great golf.
      </p>
    </div>
  )
}
