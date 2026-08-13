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
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('full_name, email, avatar_url, handicap, location, bio, occupation, company, golf_club, interests, ask_me_about, app_role')
    .eq('id', user.id)
    .single()

  // Do NOT silently treat a failed query as a blank profile — this was
  // the actual root cause of "email populated, name isn't" in the last QA
  // round (a missing column made the whole select fail, and every field
  // quietly fell back to empty since the error was never checked). Now
  // surfaced explicitly: full detail logged server-side, a friendly
  // message shown to the user instead of guessing at blank defaults.
  if (profileError) {
    console.error('[profile page] Could not load profile', {
      code: profileError.code, message: profileError.message,
      details: profileError.details, hint: profileError.hint,
      userId: user.id,
    })
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px' }}>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 14 }}>
          Your profile couldn&apos;t be loaded. Please try again.
        </p>
      </div>
    )
  }

  // Resilient name resolution (Sprint 5I QA), full 4-step order:
  // 1. profiles.full_name, 2. auth user_metadata.full_name, 3. auth
  // user_metadata.name, 4. neutral fallback (handled by ProfileForm's own
  // `{name || 'Your name'}`, only reached when steps 1-3 all come up
  // empty). Self-heals the profiles row on step 2/3 so this only needs to
  // happen once per account.
  let resolvedName: string = profile?.full_name ?? ''
  if (!resolvedName.trim()) {
    const metaName = ((user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined)?.trim()
    if (metaName) {
      resolvedName = metaName
      await db.from('profiles').update({ full_name: metaName }).eq('id', user.id)
    }
  }

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
        initialName={resolvedName}
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
      {/* Course Library v1 — UX-only entry point, not the security
          boundary (requireAdmin() + RLS independently enforce that on
          every request regardless of whether this link is even
          rendered). Kept simple rather than adding a whole admin nav
          section for one screen. */}
      {profile?.app_role === 'admin' && (
        <a
          href="/admin/courses"
          style={{
            display: 'block', textAlign: 'center', marginTop: 16, padding: '12px 0',
            borderRadius: 10, background: '#ffffff', border: '1.5px solid #c9a84c',
            color: '#7a5c00', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, textDecoration: 'none',
          }}
        >
          🏌️ Course Library Admin
        </a>
      )}
    </>
  )
}
