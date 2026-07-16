import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileForm from './ProfileForm'
import DevResetSection from '@/components/profile/DevResetSection'

export const metadata: Metadata = { title: 'My Profile' }

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase
  const { data: profile } = await db
    .from('profiles')
    .select('full_name, email, avatar_url, handicap')
    .eq('id', user.id)
    .single()

  const showDevReset = process.env.ENABLE_TEST_ACCOUNT_RESET === 'true'

  return (
    <>
      <ProfileForm
        userId={user.id}
        authEmail={user.email ?? ''}
        initialName={profile?.full_name ?? ''}
        initialEmail={profile?.email ?? user.email ?? ''}
        initialHandicap={profile?.handicap ?? null}
        avatarUrl={profile?.avatar_url ?? null}
      />
      {showDevReset && (
        <DevResetSection
          userEmail={user.email ?? ''}
          userId={user.id}
        />
      )}
    </>
  )
}
