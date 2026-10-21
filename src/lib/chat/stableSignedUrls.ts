// Phase A-6 (performance) — stable Chat image URLs.
//
// ROOT CAUSE: GET /api/trips/[tripId]/messages is polled every 4 s and
// minted a brand-new signed Storage URL for every Moment image on every
// poll. A signed URL carries a fresh token each time, so the <img src>
// string changed every 4 s: the browser treated it as a new resource
// (re-downloading the full-size image, bypassing its cache) and the server
// made one Storage "sign" call per image per poll, per phone.
//
// FIX, two layers, both pure and unit-tested here:
//   1. Server: SignedUrlCache — reuse a URL already minted for the SAME
//      user + path while it still has plenty of life left.
//   2. Client: stabiliseUrls — keep showing the URL already on screen for
//      a given message while it is still valid, instead of swapping in the
//      new-but-equivalent one from each poll.
//
// SAFETY RULES (these are what the tests pin):
//   - The cache key includes the user id. A URL minted for one person is
//     never handed to another (storage policy may differ per user).
//   - A URL is only reused while >= MIN_REUSE_REMAINING_MS of its life is
//     left, so a handed-out URL is always valid for a good while after.
//   - The cache only skips the SIGNING call. The RLS-checked event_messages
//     query still runs on every request, so a message the user can no
//     longer see (or a deleted/revoked moment) yields no URL at all.
//   - Client: a missing/null incoming URL always clears the kept URL
//     (revocation), a different file always replaces it, and a kept URL
//     that errors on load is refreshed immediately.

export const SIGN_TTL_SECONDS = 3600
/** Server reuses a cached URL only while at least this much life remains. */
export const MIN_REUSE_REMAINING_MS = 15 * 60 * 1000
/** Client keeps showing its current URL while at least this much life remains. */
export const MIN_CLIENT_KEEP_REMAINING_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

/** Expiry (ms since epoch) from a Supabase signed URL's JWT `token`, or null. */
export function signedUrlExpiryMs(url: string): number | null {
  try {
    const q = url.indexOf('?')
    if (q < 0) return null
    const token = new URLSearchParams(url.slice(q + 1)).get('token')
    if (!token) return null
    const parts = token.split('.')
    if (parts.length < 2) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary')
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

/** The file part of a signed URL (everything before the query string). */
export function signedUrlBase(url: string): string {
  const q = url.indexOf('?')
  return q < 0 ? url : url.slice(0, q)
}

// ── Server-side cache ───────────────────────────────────────────────────────

interface CacheEntry { url: string; expiresAtMs: number }

export class SignedUrlCache {
  private entries = new Map<string, CacheEntry>()
  constructor(private readonly maxEntries: number = MAX_CACHE_ENTRIES) {}

  private key(userId: string, path: string) { return `${userId}\u0000${path}` }

  get(userId: string, path: string, nowMs: number): string | null {
    const k = this.key(userId, path)
    const e = this.entries.get(k)
    if (!e) return null
    if (e.expiresAtMs - nowMs < MIN_REUSE_REMAINING_MS) {
      this.entries.delete(k)
      return null
    }
    return e.url
  }

  set(userId: string, path: string, url: string, nowMs: number, ttlSeconds: number = SIGN_TTL_SECONDS): void {
    const expiresAtMs = signedUrlExpiryMs(url) ?? nowMs + ttlSeconds * 1000
    // Never cache something that is already too close to expiry to reuse.
    if (expiresAtMs - nowMs < MIN_REUSE_REMAINING_MS) return
    if (this.entries.size >= this.maxEntries) this.evict(nowMs)
    this.entries.set(this.key(userId, path), { url, expiresAtMs })
  }

  private evict(nowMs: number) {
    for (const [k, e] of this.entries) {
      if (e.expiresAtMs - nowMs < MIN_REUSE_REMAINING_MS) this.entries.delete(k)
    }
    // Still full: drop the oldest-inserted entries (Map keeps insertion order).
    while (this.entries.size >= this.maxEntries) {
      const first = this.entries.keys().next().value
      if (first === undefined) break
      this.entries.delete(first)
    }
  }

  get size() { return this.entries.size }
}

// ── Client-side stabiliser ──────────────────────────────────────────────────

export interface StableUrlEntry { url: string; expMs: number | null; firstSeenMs: number }
export type StableUrlMap = Map<string, StableUrlEntry>

/**
 * Given the URLs already on screen (`prev`, keyed by message id) and the
 * URLs from the latest poll (`incoming`), return the URLs to display and the
 * updated map. `forceRefresh` lists ids whose current URL failed to load.
 */
export function stabiliseUrls(
  prev: StableUrlMap,
  incoming: Record<string, string | null | undefined>,
  nowMs: number,
  forceRefresh: ReadonlySet<string> = new Set(),
): { map: StableUrlMap; urls: Record<string, string | null> } {
  const map: StableUrlMap = new Map()
  const urls: Record<string, string | null> = {}
  for (const [id, next] of Object.entries(incoming)) {
    if (!next) { urls[id] = null; continue }          // revoked / no image → clear
    const kept = prev.get(id)
    const remaining = kept ? (kept.expMs ?? kept.firstSeenMs + 50 * 60 * 1000) - nowMs : -1
    const keep =
      !!kept &&
      !forceRefresh.has(id) &&
      signedUrlBase(kept.url) === signedUrlBase(next) &&
      remaining >= MIN_CLIENT_KEEP_REMAINING_MS
    if (keep && kept) {
      map.set(id, kept)
      urls[id] = kept.url
    } else {
      map.set(id, { url: next, expMs: signedUrlExpiryMs(next), firstSeenMs: nowMs })
      urls[id] = next
    }
  }
  return { map, urls }
}
