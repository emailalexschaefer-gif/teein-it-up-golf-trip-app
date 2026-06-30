/**
 * Type helper for Supabase query results when the generic inference fails
 * through async function boundaries in Next.js server components.
 *
 * Usage:
 *   const result = await supabase.from('profiles').select('full_name').single()
 *   const data = typed<{ full_name: string }>(result.data)
 */
export function typed<T>(value: unknown): T | null {
  return value as T | null
}
