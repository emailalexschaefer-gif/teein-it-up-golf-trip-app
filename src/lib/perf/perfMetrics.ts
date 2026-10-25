// Phase A-7 — pure helpers for lightweight Web Vitals / route-timing
// reporting. No browser or server APIs here, so everything is unit-tested.
//
// PRIVACY RULES (pinned by tests):
//   - Routes are reported as PATTERNS (`/trips/:id/rounds/:id`), never with
//     real ids, invite codes or query strings.
//   - Only a metric name, a rounded number, a rating and a route pattern
//     are ever reported. No user id, name, score, chat text, token or URL.

export type VitalName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB' | 'FID'
export type Rating = 'good' | 'needs-improvement' | 'poor'

// Google's published thresholds (good / poor boundaries).
const THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
}

export function isVitalName(n: string): n is VitalName {
  return n in THRESHOLDS
}

export function ratingFor(name: VitalName, value: number): Rating {
  const [good, poor] = THRESHOLDS[name]
  if (value <= good) return 'good'
  if (value <= poor) return 'needs-improvement'
  return 'poor'
}

/** CLS is a unit-less score (0.1 = good); report it ×1000 so GA4 keeps precision as an integer. */
export function reportableValue(name: VitalName, value: number): number {
  return Math.round(name === 'CLS' ? value * 1000 : value)
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Turn a real path into a pattern: ids/codes removed, query and hash dropped. */
export function normaliseRoute(path: string): string {
  let p = path
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname
  } catch { /* keep as is */ }
  p = p.split('?')[0].split('#')[0]
  p = p.replace(/^\/join\/[^/]+/, '/join/:code')
  p = p.replace(/^\/s\/[^/]+/, '/s/:token').replace(/^\/api\/s\/[^/]+/, '/api/s/:token').replace(/^\/l\/[^/]+/, '/l/:token').replace(/^\/api\/l\/[^/]+/, '/api/l/:token')
  p = p.replace(UUID, ':id')
  // any other long opaque segment (tokens, slugs with digits) or pure number
  p = p
    .split('/')
    .map(seg => (/^\d+$/.test(seg) || (seg.length >= 20 && /\d/.test(seg)) ? ':id' : seg))
    .join('/')
  return p === '' ? '/' : p
}

/** Only the API routes we care about measuring; anything else is ignored. */
const TRACKED_API = [
  /^\/api\/trips\/:id\/rounds\/:id\/my-scores$/,
  /^\/api\/trips\/:id\/rounds\/:id\/leaderboard$/,
  /^\/api\/trips\/:id\/rounds\/:id\/tournament$/,
  /^\/api\/trips\/:id\/messages$/,
  /^\/api\/trips\/:id\/members$/,
  /^\/api\/scores$/,
]
export function isTrackedApiRoute(pattern: string): boolean {
  return TRACKED_API.some(re => re.test(pattern))
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Parse `Server-Timing: app;dur=123.4` entries; returns the app duration in ms or null. */
export function serverDurFromTimings(timings: ReadonlyArray<{ name: string; duration: number }> | undefined): number | null {
  const t = timings?.find(x => x.name === 'app')
  return t && Number.isFinite(t.duration) ? t.duration : null
}

export interface ApiSample { total: number; server: number | null; ok: boolean }
export interface ApiSummary {
  route: string
  count: number
  total_p50: number
  total_max: number
  server_p50: number   // 0 when the server sent no timing
  /** total − server: time spent on the network + queueing, i.e. what region/latency affects. */
  overhead_p50: number
  errors: number
}

export function summariseApiSamples(route: string, samples: ApiSample[]): ApiSummary {
  const totals = samples.map(s => s.total)
  const servers = samples.filter(s => s.server !== null).map(s => s.server as number)
  const overheads = samples.filter(s => s.server !== null).map(s => Math.max(0, s.total - (s.server as number)))
  return {
    route,
    count: samples.length,
    total_p50: Math.round(median(totals)),
    total_max: Math.round(Math.max(0, ...totals)),
    server_p50: Math.round(median(servers)),
    overhead_p50: Math.round(median(overheads)),
    errors: samples.filter(s => !s.ok).length,
  }
}

/**
 * Server-Timing header value for a handler that took `ms`. When the
 * platform tells us which region ran the function (Vercel sets
 * VERCEL_REGION, e.g. "syd1" / "iad1"), it is added as a second entry so
 * real-user data shows WHERE requests were actually served — the direct
 * answer to the "is the function far from the user/database" question.
 */
export function serverTimingHeader(ms: number, region?: string | null): string {
  const base = `app;dur=${Math.max(0, Math.round(ms * 10) / 10)}`
  // Region codes are short [a-z0-9-] tokens; anything else is ignored rather than echoed.
  return region && /^[a-z0-9-]{2,20}$/i.test(region) ? `${base}, region;desc="${region}"` : base
}

/** The function region from a `region;desc="…"` Server-Timing entry, or null. */
export function serverRegionFromTimings(timings: ReadonlyArray<{ name: string; description?: string }> | undefined): string | null {
  const t = timings?.find(x => x.name === 'region')
  return t?.description && /^[a-z0-9-]{2,20}$/i.test(t.description) ? t.description : null
}
