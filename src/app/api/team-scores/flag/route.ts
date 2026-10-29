import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleTeamAction } from '@/lib/ambrose/teamRpc'
import { ambroseEnabled } from '@/lib/ambrose/featureFlag'
import { makeTripAllowed } from '@/lib/ambrose/tripGate'

// Package 4 / M2. Uses the SIGNED-IN USER's client on purpose: the database function reads auth.uid() and decides authority itself.
// Never swap this for the admin/service-role client.
export async function POST(request: Request) {
  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const result = await handleTeamAction('flag', body, {
    enabled: () => ambroseEnabled(),
    tripAllowed: makeTripAllowed(supabase as never),
    getUser: async () => { const { data: { user }, error } = await supabase.auth.getUser(); return error || !user ? null : { id: user.id } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (fn, args) => (supabase as any).rpc(fn, args),
  })
  return NextResponse.json(result.body, { status: result.status })
}
