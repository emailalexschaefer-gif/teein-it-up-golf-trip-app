/**
 * Release 3S -- the PUBLIC presentation viewer (no account). Read-only.
 * Unknown, malformed and revoked tokens all render the same "no longer
 * available" page. Only the public (consent-filtered) deck is ever read here;
 * the event-only deck is never selected. Never indexed; link previews use the
 * static brand image only, never a participant photo.
 */
import type { Metadata } from 'next'
import { isPlausibleShareToken } from '@/lib/sharing/token'
import { getAdmin } from '@/lib/sharing/server'
import { resolveMediaMarkers, type StoredDeck } from '@/lib/sharing/snapshot'
import SharedPresentationViewer from '@/components/memories/SharedPresentationViewer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ token: string }> }

interface PublicRow { public_enabled: boolean; trip_id: string; title: string; public_deck: StoredDeck; approved_public_moment_ids: string[]; duration_seconds: number }

async function loadActive(token: string): Promise<PublicRow | null> {
  if (!isPlausibleShareToken(token)) return null
  const admin = getAdmin()
  const { data } = await admin.from('shared_presentations')
    .select('public_enabled, trip_id, title, public_deck, approved_public_moment_ids, duration_seconds')
    .eq('token', token).eq('status', 'active').eq('public_enabled', true).maybeSingle()
  return (data as PublicRow | null) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const row = await loadActive(token)
  const title = row ? `Relive the memories — ${row.title}` : "Teein' It Up"
  return {
    title,
    description: 'Revisit the highlights, winners, laughs and unforgettable Moments.',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    openGraph: { title, description: 'Revisit the highlights, winners, laughs and unforgettable Moments.', images: [{ url: '/brand/logo-new-720.png' }] },
  }
}

export default async function PublicPresentationPage({ params }: Props) {
  const { token } = await params
  const row = await loadActive(token)
  if (!row) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: '#0f2d1c', color: '#faf6ed' }}>
        <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 26, margin: '0 0 8px' }}>This presentation is no longer available</h1>
        <p style={{ opacity: 0.85, margin: 0 }}>The link may have been withdrawn by the organiser.</p>
      </main>
    )
  }
  const allowed = new Set(row.approved_public_moment_ids ?? [])
  const slides = resolveMediaMarkers(row.public_deck.slides, allowed, id => `/api/s/${token}/m/${id}`)
  const duration = row.duration_seconds === 5 || row.duration_seconds === 10 ? row.duration_seconds : 8
  return (
    <SharedPresentationViewer
      mode="public" eventName={row.title} slides={slides} durationSeconds={duration}
      aftershowStartIndex={row.public_deck.aftershowStartIndex} aftershowLoop={row.public_deck.aftershowLoop}
    />
  )
}
