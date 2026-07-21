'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { initials, avatarColor } from '@/lib/utils'
import { GoldAvatar } from '@/components/ui/Avatar'

interface Props { userName: string; avatarUrl: string | null }

export default function AppNav({ userName, avatarUrl }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    setOpen(false)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <header style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 100%)',
        borderBottom: '2px solid #c9a84c',
        boxShadow: '0 2px 16px rgba(0,0,0,0.35)',
      }} className="sticky top-0 z-40 flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">

          {/* Simplified app logo */}
          <a href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0 active:opacity-80 transition-opacity">
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: '#0f2d1c',
              border: '1.5px solid #c9a84c',
              overflow: 'hidden', padding: 2,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-app.png"
                alt="Teein' It Up"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
            <div style={{ lineHeight: 1.1 }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                color: '#e8c96a',
                fontSize: 15.5, fontWeight: 800, letterSpacing: 0.3,
              }}>Teein&apos; It Up</div>
              <div style={{
                fontFamily: 'var(--font-body)',
                color: '#f5e6b8',
                fontSize: 8.5, fontWeight: 600, letterSpacing: 1.6,
                textTransform: 'uppercase', opacity: 0.6, marginTop: 1,
              }}>Golf Event App</div>
            </div>
          </a>

          {/* Right: New Trip + avatar */}
          <div className="flex items-center gap-2">
            <a
              href="/trips/new"
              className="hidden sm:flex items-center gap-1.5 active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(135deg, #2d7a52 0%, #1a4731 100%)',
                border: '1px solid rgba(201,168,76,0.3)',
                borderRadius: 10, padding: '6px 14px',
                fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700,
                color: '#e8c96a', letterSpacing: 0.4,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                textDecoration: 'none',
              }}
            >
              + New Trip
            </a>

            <div style={{
              background: 'rgba(201,168,76,0.15)',
              border: '1px solid rgba(201,168,76,0.4)',
              borderRadius: 16, padding: '3px 9px',
              fontFamily: 'var(--font-body)', color: '#e8c96a',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            }}>PASS</div>

            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="focus:outline-none active:scale-95 transition-transform"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={userName}
                  className="w-9 h-9 rounded-full object-cover border-2 border-gold"
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <GoldAvatar name={userName || '?'} size={36} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed top-14 right-4 z-50 w-52 animate-fadeIn" style={{
            background: '#f8f4eb',
            border: '1.5px solid #d9c9a3',
            borderRadius: 14,
            boxShadow: '0 8px 32px rgba(15,45,28,0.18)',
            overflow: 'hidden',
          }}>
            {/* User info */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #ede0c4' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#1a1a16' }}>
                {userName || 'My Account'}
              </p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', marginTop: 1 }}>
                Golf Event Organiser
              </p>
            </div>

            {/* Nav links — Tailwind hover, no inline JS handlers */}
            {[
              { label: '🏠  My Trips',   href: '/dashboard' },
              { label: '+ New Trip',     href: '/trips/new' },
              { label: '👤  My Profile', href: '/profile' },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-sm text-ink hover:bg-cream transition-colors border-b border-parchment"
                style={{ fontFamily: 'var(--font-body)', textDecoration: 'none' }}
              >
                {label}
              </a>
            ))}

            {/* Sign out button — Tailwind hover, no inline JS handlers */}
            <button
              type="button"
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
              style={{ fontFamily: 'var(--font-body)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              🚪  Sign out
            </button>
          </div>
        </>
      )}
    </>
  )
}
