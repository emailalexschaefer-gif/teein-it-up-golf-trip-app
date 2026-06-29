import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SyncInitializer from '@/components/layout/SyncInitializer'
import { ToastProvider } from '@/components/ui/Toast'
import type { Profile } from '@/types/app'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Explicitly typed to avoid TypeScript inferring `never` through the
  // async Supabase generic chain. Profile['full_name'] is string,
  // Profile['avatar_url'] is string | null.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', user.id)
    .single() as { data: Pick<Profile, 'full_name' | 'avatar_url'> | null; error: unknown }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-surface-muted flex flex-col">
        <AppNav
          userName={profile?.full_name || user.email || ''}
          avatarUrl={profile?.avatar_url ?? null}
        />
        <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 pb-24">
          {children}
        </main>
        <SyncInitializer />
      </div>
    </ToastProvider>
  )
}
