import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ tripId: string }> }

export default async function SideGamesPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Side Games</span>
      </div>

      {/* Preserved destination for Sprint 5C.3 — not built yet, deliberately. */}
      <div style={{ textAlign: 'center', padding: '48px 16px' }}>
        <p style={{ fontSize: 36, marginBottom: 10 }}>🎯</p>
        <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
          Side Games — coming soon
        </p>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, maxWidth: 300, margin: '0 auto', lineHeight: 1.5 }}>
          Nearest the Pin, Longest Drive, Pro&apos;s Approach and other competitions will live here in a future update.
        </p>
      </div>
    </div>
  )
}
