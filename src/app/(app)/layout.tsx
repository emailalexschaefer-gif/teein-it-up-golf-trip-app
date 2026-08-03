import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SyncInitializer from '@/components/layout/SyncInitializer'
import AuthCacheManager from '@/components/layout/AuthCacheManager'
import React from 'react'
import { ToastProvider } from '@/components/ui/Toast'

interface ProfileData { full_name: string; avatar_url: string | null }

// Wraps a promise with a hard timeout so a slow/hanging database call can
// never block the entire app shell (including AppNav and Logout, which
// live inside it) from rendering at all. This is the actual fix for the
// "app frozen, must kill Chrome" issue — previously the profile fetch
// below had no timeout of any kind, so if it ever hung (network blip,
// slow connection, stuck Supabase client), Next.js would wait
// indefinitely before rendering anything, including the header.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const userResult = await withTimeout(supabase.auth.getUser(), 4000).catch(() => null)
  const user = userResult?.data?.user ?? null
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny: any = supabase
  // 4s timeout — generous enough for a normal query, short enough that a
  // hung connection degrades to "shows initials/email instead of the
  // saved name and photo" rather than "the entire app never loads."
  const profileResult = await withTimeout(
    supabaseAny.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
    4000,
  ).catch(() => null)

  const profile: ProfileData | null = profileResult?.data ?? null

  return (
    <ToastProvider>
      {/* Demo: cream background for the whole app body */}
      <div className="min-h-screen flex flex-col" style={{ background: '#faf6ed' }}>
        <AppNav
          userName={profile?.full_name || user.email || ''}
          avatarUrl={profile?.avatar_url ?? null}
        />
        <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-5 pb-24">
          {children}
        </main>
        <SyncInitializer />
        <AuthCacheManager />
      </div>
    </ToastProvider>
  )
}
