import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SyncInitializer from '@/components/layout/SyncInitializer'
import AuthCacheManager from '@/components/layout/AuthCacheManager'
import React from 'react'
import { ToastProvider } from '@/components/ui/Toast'

interface ProfileData { full_name: string; avatar_url: string | null; user_intent: string | null; created_at: string }

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
    supabaseAny.from('profiles').select('full_name, avatar_url, user_intent, created_at').eq('id', user.id).maybeSingle(),
    4000,
  ).catch(() => null)

  const profile: ProfileData | null = profileResult?.data ?? null

  // Crucial MVP Onboarding Update — the "does this fresh account still
  // need onboarding" gate. Deliberately lives here, in the ONE layout
  // that already wraps every authenticated route, rather than modified
  // into either signup form's own success handler — per the explicit
  // "do not redesign authentication or destabilise the currently
  // working signup flows" instruction, this is a purely additive check
  // that doesn't touch SignupForm.tsx, JoinForm.tsx, or LoginForm.tsx
  // at all, and naturally covers every current AND future account-
  // creation path (including magic link, if it's ever re-enabled —
  // see the delivery report on why it's currently unreachable in the
  // UI) without needing separate wiring for each one.
  //
  // Two conditions, both required, per the explicit "do NOT force
  // existing live-event players through a disruptive new signup gate"
  // instruction:
  //   1. user_intent IS NULL — never yet answered.
  //   2. profiles.created_at is recent (within 15 minutes) — this is
  //      what actually distinguishes "a brand new account, seconds
  //      into their very first session" from "an existing account that
  //      simply predates this feature." Every pre-existing player
  //      keeps using the app completely undisturbed forever; only a
  //      genuinely fresh signup, within a short window of creating
  //      their account, ever sees this once. If they close the tab
  //      without answering, the gate simply stops applying once that
  //      window passes — never an indefinite nag on every later login.
  //
  // /onboarding/intent itself is a standalone route, outside this
  // layout group entirely (see that page's own comment) — this
  // redirect can never loop back onto itself.
  if (profile && !profile.user_intent) {
    const createdAtMs = new Date(profile.created_at).getTime()
    const minutesSinceSignup = (Date.now() - createdAtMs) / 60000
    if (minutesSinceSignup >= 0 && minutesSinceSignup < 15) {
      redirect('/onboarding/intent')
    }
  }

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
