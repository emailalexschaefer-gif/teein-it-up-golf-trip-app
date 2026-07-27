import React from 'react'
import AuthBranding from '@/components/brand/AuthBranding'

// Auth layout: Masters-dark background, full brand logo, premium card.
// Wraps every unauthenticated route (login, signup, reset-password, join)
// via Next.js route-group layout inheritance — there is exactly one of
// these, applied automatically to every page under (auth).

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(170deg, #0a1f10 0%, #0f2d1a 36%, #0e2516 68%, #050e08 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '20px 16px 28px',
    }}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        @keyframes authFadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .auth-fade-1 { animation: authFadeUp 0.5s ease-out both; }
        .auth-fade-2 { animation: authFadeUp 0.5s ease-out 0.08s both; }
        @media (prefers-reduced-motion: reduce) {
          .auth-fade-1, .auth-fade-2 { animation: none; }
        }
      `}</style>

      <div className="auth-fade-1">
        <AuthBranding />
      </div>

      {/* Auth card */}
      <div className="auth-fade-2" style={{
        width: '100%', maxWidth: 360,
        background: '#f8f4eb',
        borderRadius: 18,
        border: '1.5px solid #d9c9a3',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8)',
        padding: '28px 24px',
        marginTop: 12,
      }}>
        {children}
      </div>

      {/* Tagline */}
      <p style={{
        marginTop: 16,
        fontFamily: 'var(--font-body)',
        color: 'rgba(245,230,184,0.25)',
        fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
      }}>
        No admin chaos. Just great golf.
      </p>
    </div>
  )
}
