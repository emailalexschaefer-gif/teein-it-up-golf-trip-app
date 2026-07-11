'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { initials, avatarColor } from '@/lib/utils'

interface Props { userName: string; avatarUrl: string | null }

// Demo Header: gradient greenDeep→green, gold bottom border, logo left, user+badge right
export default function AppNav({ userName, avatarUrl }: Props) {
  const router   = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState<boolean>(false)

  async function handleSignOut() {
    setOpen(false)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const userInitials = initials(userName || '?')
  const userColor    = avatarColor(userName)

  return (
    <>
      {/* Demo: "background: linear-gradient(135deg,C.greenDeep 0%,C.green 100%),
          borderBottom: 2px solid C.gold, boxShadow: 0 2px 12px rgba(0,0,0,0.3)" */}
      <header style={{
        background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 100%)',
        borderBottom: '2px solid #c9a84c',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      }} className="sticky top-0 z-40 flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">

          {/* Demo logo: small logo circle + "Teein' It Up" in goldLight + subtitle */}
          <a href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#fff',
              border: '2px solid #c9a84c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 3,
            }}>
              <span style={{ fontSize: 20 }}>⛳</span>
            </div>
            <div style={{ lineHeight: 1 }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                color: '#e8c96a',  // C.goldLight
                fontSize: 14, fontWeight: 800, letterSpacing: 0.3,
              }}>Teein&apos; It Up</div>
              <div style={{
                fontFamily: 'var(--font-body)',
                color: '#f5e6b8',  // C.goldPale
                fontSize: 9, fontWeight: 600, letterSpacing: 1.5,
                textTransform: 'uppercase', opacity: 0.65, marginTop: 1,
              }}>Golf Event App</div>
            </div>
          </a>

          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href="/trips/new"
              className="hidden sm:block text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
              style={{
                background: 'rgba(201,168,76,0.15)',
                border: '1px solid rgba(201,168,76,0.4)',
                color: '#e8c96a',
                fontFamily: 'var(--font-body)',
              }}
            >
              + New Trip
            </a>

            {/* Demo: GoldAvatar for current user, then PASS badge */}
            <button
              onClick={() => setOpen((o: boolean) => !o)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label="Menu"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={userName}
                  className="w-9 h-9 rounded-full object-cover"
                  style={{ border: '2.5px solid #e8c96a' }} />
              ) : (
                /* Demo GoldAvatar: gold radial gradient */
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'radial-gradient(circle at 38% 35%, #e8c96a, #c9a84c)',
                  border: '2.5px solid #fdf0c8',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#0f2d1c', fontWeight: 800, fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
                }}>
                  {userInitials}
                </div>
              )}
              {/* Demo PASS badge */}
              <div style={{
                background: 'rgba(201,168,76,0.18)',
                border: '1px solid #c9a84c',
                borderRadius: 16, padding: '3px 9px',
                fontFamily: 'var(--font-body)',
                color: '#e8c96a', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              }} className="hidden sm:block">PASS</div>
            </button>
          </div>
        </div>
      </header>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed top-14 right-4 z-40 rounded-2xl w-56 overflow-hidden"
            style={{
              background: '#0f2d1c',
              border: '1px solid rgba(201,168,76,0.3)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(201,168,76,0.15)' }}>
              <p className="font-bold text-sm truncate" style={{ color: '#e8c96a', fontFamily: 'var(--font-display)' }}>
                {userName || 'Account'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(245,230,184,0.5)', fontFamily: 'var(--font-body)' }}>
                Organiser
              </p>
            </div>
            <nav className="py-1">
              <MenuItem href="/dashboard"  label="🏌️  My Trips"   onClose={() => setOpen(false)} />
              <MenuItem href="/trips/new"  label="＋  New Trip"   onClose={() => setOpen(false)} />
              <MenuItem href="/profile"    label="👤  My Profile"  onClose={() => setOpen(false)} />
            </nav>
            <div style={{ borderTop: '1px solid rgba(201,168,76,0.12)' }} className="py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
                style={{ color: '#f87171', fontFamily: 'var(--font-body)' }}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function MenuItem({ href, label, onClose }: { href: string; label: string; onClose: () => void }) {
  return (
    <a href={href} onClick={onClose}
      className="flex items-center px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
      style={{ color: 'rgba(245,230,184,0.85)', fontFamily: 'var(--font-body)' }}>
      {label}
    </a>
  )
}
