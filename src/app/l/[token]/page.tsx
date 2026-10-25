/**
 * Package 1 -- the PUBLIC live leaderboard (no account, read-only). Unknown,
 * malformed and revoked links all render the same "no longer available" page.
 * Never indexed; link previews use the static brand image only.
 */
import type { Metadata } from 'next'
import { getAdmin } from '@/lib/sharing/server'
import { buildBoardForTrip, resolveToken } from '@/lib/leaderboardShare/service'
import type { PublicBoard } from '@/lib/leaderboardShare/publicBoard'
import PublicLeaderboardView from '@/components/leaderboard/PublicLeaderboardView'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ token: string }> }

async function load(token: string): Promise<PublicBoard | null> {
  try {
    const admin = getAdmin()
    const tripId = await resolveToken(admin, token)
    if (!tripId) return null
    return await buildBoardForTrip(admin, tripId)
  } catch (e) {
    console.error('[public-leaderboard page] failed', { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const board = await load(token)
  const title = board ? `Live leaderboard — ${board.eventName}` : "Teein' It Up"
  const description = "Follow the scores live. Scored with Teein' It Up."
  return {
    title, description,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    openGraph: { title, description, images: [{ url: '/brand/logo-new-720.png' }] },
  }
}

export default async function PublicLeaderboardPage({ params }: Props) {
  const { token } = await params
  const board = await load(token)
  return <PublicLeaderboardView token={token} initial={board} />
}
