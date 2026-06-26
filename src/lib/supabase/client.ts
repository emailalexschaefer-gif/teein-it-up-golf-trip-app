// ─────────────────────────────────────────────────────────────────────────────
// Supabase browser client
// Use this in Client Components and hooks.
// Creates a singleton to avoid multiple GoTrue instances.
// ─────────────────────────────────────────────────────────────────────────────

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
