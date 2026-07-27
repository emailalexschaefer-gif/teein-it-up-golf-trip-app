import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ tripId: string }> }

export default async function TournamentPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Real permission guard, not just hiding the nav link — a player typing
  // this URL directly must not reach organiser content, per the explicit
  // "do not expose disabled organiser actions to normal players" instruction.
  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  if (membership?.role !== 'organiser') redirect(`/trips/${tripId}`)

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Tournament Control</span>
      </div>

      {/* Placeholder only — Sprint 5C.2 builds the real control centre.
          No fake working buttons, per the explicit instruction. */}
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '28px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 36, marginBottom: 10 }}>🎛️</p>
        <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
          This will become the organiser&apos;s live control centre
        </p>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
          Live group progress, scoring status, and organiser actions will appear here.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {['Group Progress', 'Players Finished', 'Reconciliation Alerts', 'Round Controls'].map(label => (
            <span key={label} style={{
              fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f',
              background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 16, padding: '5px 12px',
            }}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
