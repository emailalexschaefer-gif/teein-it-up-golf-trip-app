'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { initials } from '@/lib/utils'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'

interface Props { userName: string; avatarUrl: string | null }

export default function AppNav({ userName, avatarUrl }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [open, setOpen] = useState(false)

  const syncLabel    = useSyncStore(selectSyncLabel)
  const syncState    = useSyncStore((s) => s.syncState)
  const pendingCount = useSyncStore((s) => s.pendingCount)

  async function handleSignOut() {
    setOpen(false)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <header className="bg-brand-600 text-white sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <a href="/dashboard" className="font-bold text-base tracking-tight flex-shrink-0">
            Teein&apos; It Up
          </a>

          {pendingCount > 0 && (
            <div className={[
              'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full flex-1 max-w-xs',
              syncState === 'error' ? 'bg-red-500/20 text-red-200' : 'bg-white/10 text-white/80',
            ].join(' ')}>
              {syncState === 'syncing' && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
              )}
              <span className="truncate">{syncLabel}</span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href="/trips/new"
              className="hidden sm:flex items-center gap-1 text-xs font-medium bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors"
            >
              + New trip
            </a>
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center hover:opacity-80 transition-opacity"
              aria-label="Menu"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={userName} className="w-8 h-8 rounded-full object-cover bg-brand-400" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-400 flex items-center justify-center text-xs font-bold">
                  {initials(userName || '?')}
                </div>
              )}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed top-14 right-4 z-40 bg-white rounded-2xl shadow-card-hover border border-surface-subtle w-52 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-subtle">
              <p className="text-sm font-semibold text-text truncate">{userName}</p>
            </div>
            <nav className="py-1">
              <NavItem href="/dashboard" label="My Trips" active={pathname === '/dashboard'} onClick={() => setOpen(false)} />
              <NavItem href="/trips/new" label="New trip" onClick={() => setOpen(false)} />
            </nav>
            <div className="border-t border-surface-subtle py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors text-left"
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

function NavItem({ href, label, active, onClick }: {
  href: string; label: string; active?: boolean; onClick?: () => void
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={[
        'flex items-center px-4 py-2.5 text-sm transition-colors',
        active ? 'text-brand-600 bg-brand-50 font-medium' : 'text-text hover:bg-surface-muted',
      ].join(' ')}
    >
      {label}
    </a>
  )
}
