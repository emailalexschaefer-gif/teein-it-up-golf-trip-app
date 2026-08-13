import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side admin check, shared by every Course Library Admin API
 * route. This — not the client-side nav hiding in the Admin UI — is the
 * actual security boundary, per the explicit "do not use client-side UI
 * hiding as the security boundary" instruction. RLS (migration 039)
 * enforces the same rule again at the database layer independently, so
 * even a route that forgot to call this would still be blocked by
 * Postgres itself — this check exists to return a clean 403 with a
 * useful message rather than relying solely on a raw RLS denial.
 */
export async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }
> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, status: 401, error: 'Not authenticated.' }

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()
  const profileRes = await admin.from('profiles').select('app_role').eq('id', user.id).maybeSingle()
  if (profileRes.data?.app_role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin access required.' }
  }
  return { ok: true, userId: user.id }
}
