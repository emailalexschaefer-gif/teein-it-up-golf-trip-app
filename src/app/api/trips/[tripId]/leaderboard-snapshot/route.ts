/**
 * GET -> the public-shaped board (same builder as the public link) for the
 * PNG / PDF exports. Any event member. Works whether or not the public link is
 * enabled: saving an image or PDF is not "public sharing".
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, NO_STORE_HEADERS } from '@/lib/sharing/server'
import { buildBoardForTrip } from '@/lib/leaderboardShare/service'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  if (!(await getMemberRole(admin, tripId, user.id))) return json({ error: 'Not a trip member.' }, 403)
  try {
    const board = await buildBoardForTrip(admin, tripId)
    if (!board) return json({ error: 'No leaderboard available for this event.' }, 409)
    return json(board)
  } catch (e) {
    console.error('[leaderboard-snapshot] failed', { tripId, error: e instanceof Error ? e.message : String(e) })
    return json({ error: "Couldn't load the leaderboard right now." }, 500)
  }
}
