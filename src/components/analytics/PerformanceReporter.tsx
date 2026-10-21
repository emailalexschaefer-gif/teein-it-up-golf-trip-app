'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'
import { trackEvent } from '@/lib/analytics/trackEvent'
import {
  isTrackedApiRoute, isVitalName, normaliseRoute, ratingFor, reportableValue,
  serverDurFromTimings, serverRegionFromTimings, summariseApiSamples, type ApiSample,
} from '@/lib/perf/perfMetrics'

/**
 * Phase A-7 (performance) — lightweight real-user measurement.
 *
 * Reports, through the EXISTING analytics layer (trackEvent → GA4, which
 * already no-ops when GA isn't configured):
 *   web_vital  — LCP / INP / CLS / FCP / TTFB, once each per page view,
 *                with Google's good/needs-improvement/poor rating.
 *   api_timing — per tracked API route: median total time, median SERVER
 *                time (from the Server-Timing header), and the difference
 *                (network overhead — what a region mismatch inflates).
 *   nav_timing — tap-to-new-screen time for in-app navigation.
 *
 * Privacy: routes are normalised to patterns (no ids/codes/query strings);
 * only metric names, rounded numbers and ratings are sent — never a user
 * id, name, score, chat text, token or URL. Respects Do Not Track.
 *
 * Overhead: no network of its own, no polling, one passive
 * PerformanceObserver, all work wrapped in try/catch, and a hard cap on
 * events per page view. It renders nothing and cannot affect scoring.
 *
 * Also exposes the raw numbers on window.__tiuPerf for DevTools / remote
 * debugging while benchmarking.
 */

const MAX_EVENTS_PER_PAGE_VIEW = 40
const MAX_SAMPLES_PER_ROUTE = 200

interface PerfStore {
  vitals: Record<string, { value: number; rating: string; route: string }>
  api: Record<string, ApiSample[]>
  /** Function region seen in Server-Timing (e.g. "syd1"), once known. */
  region?: string
  nav: { from: string; to: string; ms: number }[]
}

declare global {
  interface Window { __tiuPerf?: PerfStore }
}

function enabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (navigator.doNotTrack === '1') return false
  } catch { /* ignore */ }
  return true
}

function store(): PerfStore {
  if (!window.__tiuPerf) window.__tiuPerf = { vitals: {}, api: {}, nav: [] }
  return window.__tiuPerf
}

export default function PerformanceReporter() {
  const pathname = usePathname()
  const lastClickAtRef = useRef(0)
  const lastRouteRef = useRef<string | null>(null)
  const sentRef = useRef(0)

  // Web Vitals (Next's built-in hook — no extra dependency).
  useReportWebVitals(metric => {
    try {
      if (!enabled() || !isVitalName(metric.name)) return
      const route = normaliseRoute(window.location.pathname)
      const rating = ratingFor(metric.name, metric.value)
      store().vitals[metric.name] = { value: metric.value, rating, route }
      trackEvent('web_vital', {
        metric_name: metric.name,
        metric_value: reportableValue(metric.name, metric.value),
        metric_rating: rating,
        route,
      })
    } catch { /* never break the app */ }
  })

  useEffect(() => {
    if (!enabled() || typeof PerformanceObserver === 'undefined') return
    let observer: PerformanceObserver | null = null

    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue
          const route = normaliseRoute(entry.name)
          if (!isTrackedApiRoute(route)) continue
          const samples = (store().api[route] ??= [])
          const region = serverRegionFromTimings(entry.serverTiming)
          if (region) store().region = region
          samples.push({
            total: entry.duration,
            server: serverDurFromTimings(entry.serverTiming),
            ok: typeof (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus !== 'number'
              || ((entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus as number) < 400,
          })
          if (samples.length > MAX_SAMPLES_PER_ROUTE) samples.shift()
        }
      })
      observer.observe({ type: 'resource', buffered: true })
    } catch { observer = null }

    // Remember when an in-app link was tapped (see the pathname effect below).
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="/"]')
      if (a) lastClickAtRef.current = performance.now()
    }
    document.addEventListener('click', onClick, { capture: true, passive: true })

    // Summarise API timings once when the page is hidden/closed.
    const flush = () => {
      try {
        const s = store()
        for (const [route, samples] of Object.entries(s.api)) {
          if (samples.length === 0 || sentRef.current >= MAX_EVENTS_PER_PAGE_VIEW) continue
          const sum = summariseApiSamples(route, samples)
          sentRef.current++
          trackEvent('api_timing', {
            route: sum.route, count: sum.count, total_p50_ms: sum.total_p50,
            total_max_ms: sum.total_max, server_p50_ms: sum.server_p50,
            overhead_p50_ms: sum.overhead_p50, errors: sum.errors,
            fn_region: s.region ?? 'unknown',
          })
          s.api[route] = []
        }
      } catch { /* ignore */ }
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      observer?.disconnect()
      document.removeEventListener('click', onClick, { capture: true } as EventListenerOptions)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Tap-to-new-screen time: when the route changes after an in-app link tap,
  // read the clock after the next two frames (i.e. once the new screen has
  // actually been painted).
  useEffect(() => {
    if (!enabled()) return
    const to = normaliseRoute(pathname ?? '/')
    const from = lastRouteRef.current
    lastRouteRef.current = to
    const started = lastClickAtRef.current
    lastClickAtRef.current = 0
    if (from === null || from === to || started <= 0) return
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const ms = Math.round(performance.now() - started)
        if (ms > 0 && ms < 30_000 && sentRef.current < MAX_EVENTS_PER_PAGE_VIEW) {
          sentRef.current++
          store().nav.push({ from, to, ms })
          trackEvent('nav_timing', { from_route: from, to_route: to, duration_ms: ms })
        }
      } catch { /* ignore */ }
    }))
    return () => cancelAnimationFrame(raf)
  }, [pathname])

  return null
}
