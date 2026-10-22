// Test stub for '@/lib/supabase/server': the "user-session" client.
import { getHarness } from '../state'

export async function createClient() {
  return getHarness().sessionClient()
}
