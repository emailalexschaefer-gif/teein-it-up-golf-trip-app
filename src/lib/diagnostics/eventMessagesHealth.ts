import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Diagnostic-only health check for the event_messages table. NOT called
 * automatically anywhere in the app — not on page load, not on a schedule,
 * not wired into any route. Intended for manual use during deployment
 * verification: confirms the table is actually visible to PostgREST via
 * the same client path the real API routes use, which is a more direct
 * signal than checking Vercel environment variables alone (a correct env
 * var pointing at the right project doesn't guarantee PostgREST's schema
 * cache has picked up a table that was created after the cache last
 * refreshed).
 *
 * Usage (manually, e.g. from a temporary debug route or a local script):
 *   const supabase = await createClient()
 *   const ok = await checkEventMessagesTable(supabase)
 */
export async function checkEventMessagesTable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from('event_messages').select('id').limit(1)
  if (error) {
    console.error('event_messages health check failed', { code: error.code, message: error.message })
    return false
  }
  return true
}
