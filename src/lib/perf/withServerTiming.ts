// Phase A-7 — wraps an existing route handler so its response carries a
// `Server-Timing: app;dur=…` header. The browser exposes that header to
// the page (PerformanceResourceTiming.serverTiming), which lets the
// client reporter split a request into "time on the server" vs "time on
// the network", i.e. exactly what a Vercel/Supabase region mismatch would
// inflate.
//
// It never changes the response body or status, never swallows an error
// (a throw propagates exactly as before), and never logs request data.
// Only calls slower than SLOW_MS write one log line: label, status, ms.

import { serverTimingHeader } from './perfMetrics'

export const SLOW_MS = 2000

export function withServerTiming<A extends unknown[]>(
  label: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const start = Date.now()
    const res = await handler(...args)
    const ms = Date.now() - start
    try {
      res.headers.set('Server-Timing', serverTimingHeader(ms, process.env.VERCEL_REGION))
    } catch {
      // Immutable headers (e.g. a redirect from some runtimes) — timing is
      // optional, the response itself is untouched.
    }
    if (ms >= SLOW_MS) console.warn(`[perf-slow] ${label} status=${res.status} ms=${ms}`)
    return res
  }
}
