// Release 3S — public name handling. The photo-sharing checkbox does NOT
// authorise showing full names to people outside the event, so the public
// version abbreviates surnames ("Alex Smith" -> "Alex S.") unless the
// organiser explicitly chooses full names at publish time.

export type PublicNameMode = 'initials' | 'full'

export function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? fullName
  const last = parts[parts.length - 1]
  const initial = Array.from(last)[0]?.toUpperCase() ?? ''
  return `${parts.slice(0, -1).join(' ')} ${initial}.`
}

/**
 * Replaces every occurrence of each full name in every string of `value`
 * (deep, including text such as Makers & Breakers stat lines) with its
 * abbreviation. Returns a new structure; the input is not mutated. Longest
 * names are replaced first so "Ann Lee-Smith" is not partially matched by a
 * shorter name. Names are matched literally (no regex).
 */
export function abbreviateNamesDeep<T>(value: T, fullNames: string[]): T {
  const names = [...new Set(fullNames.map(n => n.trim()).filter(n => /\s/.test(n)))].sort((a, b) => b.length - a.length)
  if (names.length === 0) return value
  const replacements = names.map(n => [n, abbreviateName(n)] as const)
  const swap = (s: string) => {
    let out = s
    for (const [full, short] of replacements) if (out.includes(full)) out = out.split(full).join(short)
    return out
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val)
      return o
    }
    return v
  }
  return walk(value) as T
}
