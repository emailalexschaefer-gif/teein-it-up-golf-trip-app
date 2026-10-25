/**
 * GET /api/l/[token] -- the PUBLIC live leaderboard (no account). Read-only.
 * Authorised only by an unguessable token whose link is active. Unknown,
 * malformed and revoked tokens return the same 404. Responses are cached for a
 * few seconds at the CDN so many viewers cost one computation, not one each,
 * and never touch scoring writes.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getAdmin } from '@/lib/sharing/server'
import { buildBoardForTrip, resolveToken } from '@/lib/leaderboardShare/service'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ token: string }> }

const BASE = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } as const
export const PUBLIC_CACHE = 'public, s-maxage=15, stale-while-revalidate=30'

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { token } = await params
  const notFound = () => NextResponse.json({ error: 'This leaderboard link is no longer available.' }, { status: 404, headers: { ...BASE, 'Cache-Control': 'no-store' } })
  try {
    const admin = getAdmin()
    const tripId = await resolveToken(admin, token)
    if (!tripId) return notFound()
    const board = await buildBoardForTrip(admin, tripId)
    if (!board) return notFound()
    return NextResponse.json(board, { headers: { ...BASE, 'Cache-Control': PUBLIC_CACHE } })
  } catch (e) {
    console.error('[public-leaderboard] failed', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Couldn't load the leaderboard right now." }, { status: 500, headers: { ...BASE, 'Cache-Control': 'no-store' } })
  }
}
