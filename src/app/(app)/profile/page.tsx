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
    .select('full_name, email, avatar_url, handicap, location, bio, occupation, company, golf_club, interests, ask_me_about')
    .eq('id', user.id)
    .single()

  // Teein' It Up Role — computed from actual trip_members rows across all
  // of this user's trips, not stored redundantly. A user who organises at
  // least one trip and also plays in at least one (possibly the same one)
  // sees "Player & Organiser"; otherwise whichever role actually applies.
  const { data: roles } = await db.from('trip_members').select('role').eq('profile_id', user.id)
  const isOrganiserAnywhere = (roles ?? []).some((r: { role: string }) => r.role === 'organiser')
  const isPlayerAnywhere = (roles ?? []).some((r: { role: string }) => r.role === 'player')
  const teeinItUpRole = isOrganiserAnywhere && isPlayerAnywhere ? 'Player & Organiser'
    : isOrganiserAnywhere ? 'Golf Trip Organiser'
    : isPlayerAnywhere ? 'Player'
    : 'Player'

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
        initialLocation={profile?.location ?? ''}
        initialBio={profile?.bio ?? ''}
        initialOccupation={profile?.occupation ?? ''}
        initialCompany={profile?.company ?? ''}
        initialGolfClub={profile?.golf_club ?? ''}
        initialInterests={profile?.interests ?? []}
        initialAskMeAbout={profile?.ask_me_about ?? ''}
        teeinItUpRole={teeinItUpRole}
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
