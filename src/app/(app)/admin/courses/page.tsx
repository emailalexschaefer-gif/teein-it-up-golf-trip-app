import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CourseLibraryAdminClient from './CourseLibraryAdminClient'

export const dynamic = 'force-dynamic'

/**
 * Server-side gate — the same reasoning as requireAdmin() for the API
 * routes, applied here so a non-admin never even sees the Admin UI
 * shell, not just fails its API calls. This is UX (avoid a confusing
 * "everything errors" screen), not the actual security boundary — that
 * boundary is requireAdmin() + RLS, both already enforced independently
 * of whether this page-level check exists at all.
 */
export default async function CourseLibraryAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profileRes = await supabase.from('profiles').select('app_role').eq('id', user.id).maybeSingle()
  if (profileRes.data?.app_role !== 'admin') redirect('/dashboard')

  return <CourseLibraryAdminClient />
}
