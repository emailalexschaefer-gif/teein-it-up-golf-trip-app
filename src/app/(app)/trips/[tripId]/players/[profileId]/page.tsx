import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ tripId: string; profileId: string }> }

export default async function PlayerProfilePage({ params }: Props) {
  const { tripId, profileId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase

  // Confirm the viewer is actually a member of this trip — belt and
  // suspenders alongside RLS, so a non-member gets a clear "not found"
  // rather than depending solely on the database silently returning
  // nothing (which it would anyway, via the existing "Trip members can
  // view each other" policy — this is just a clearer failure path).
  const { data: viewerMembership } = await db
    .from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!viewerMembership) notFound()

  const { data: profile } = await db
    .from('profiles')
    .select('full_name, avatar_url, handicap, location, bio, occupation, company, golf_club, interests, ask_me_about')
    .eq('id', profileId)
    .maybeSingle()
  if (!profile) notFound()

  const { data: roleRows } = await db.from('trip_members').select('role').eq('profile_id', profileId)
  const isOrganiserAnywhere = (roleRows ?? []).some((r: { role: string }) => r.role === 'organiser')
  const isPlayerAnywhere = (roleRows ?? []).some((r: { role: string }) => r.role === 'player')
  const role = isOrganiserAnywhere && isPlayerAnywhere ? 'Player & Organiser'
    : isOrganiserAnywhere ? 'Golf Trip Organiser' : 'Player'

  const initials = (profile.full_name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Profile</span>
      </div>

      {/* Identity Card — same visual language as My Profile's own preview */}
      <div style={{
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 14, padding: '20px 18px',
        marginBottom: 16, boxShadow: '0 4px 18px rgba(20,83,45,0.2)', textAlign: 'center',
      }}>
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt={profile.full_name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 10px', display: 'block', border: '3px solid rgba(255,255,255,0.3)' }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: '50%', margin: '0 auto 10px', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, fontSize: 22, color: '#0f2d1c' }}>
            {initials}
          </div>
        )}
        <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 18, fontWeight: 800 }}>{profile.full_name}</div>
        {profile.handicap !== null && (
          <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 13, marginTop: 2 }}>Playing Handicap: {profile.handicap}</div>
        )}
        {profile.location && (
          <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 }}>{profile.location}</div>
        )}
        <div style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '3px 12px' }}>
          {role}
        </div>
      </div>

      {profile.ask_me_about && (
        <div style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Ask me about</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#5a4310' }}>{profile.ask_me_about}</div>
        </div>
      )}

      {profile.bio && (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 12, padding: '14px', marginBottom: 12 }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#3d3a2f', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        </div>
      )}

      {(profile.occupation || profile.company || profile.golf_club) && (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 12, padding: '14px', marginBottom: 12 }}>
          {profile.occupation && <DetailRow label="Occupation" value={profile.occupation} />}
          {profile.company && <DetailRow label="Company" value={profile.company} />}
          {profile.golf_club && <DetailRow label="Golf Club" value={profile.golf_club} />}
        </div>
      )}

      {profile.interests && profile.interests.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Interests</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {profile.interests.map((tag: string) => (
              <span key={tag} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, padding: '6px 13px', borderRadius: 18, background: '#f8f4eb', border: '1.5px solid #e5ddc8', color: '#3d3a2f' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f1' }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#3d3a2f' }}>{value}</span>
    </div>
  )
}
