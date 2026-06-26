import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SyncInitializer from '@/components/layout/SyncInitializer'
import AppNav from '@/components/layout/AppNav'
import { ToastProvider } from '@/components/ui/Toast'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', user.id)
    .single()

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
