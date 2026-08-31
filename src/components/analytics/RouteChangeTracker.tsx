'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackPageView } from '@/lib/analytics/trackEvent'

/**
 * GA4 / Product Analytics brief — "client-side navigation is handled
 * correctly, duplicate page views are avoided." Fires trackPageView()
 * on every route change, including the very first render — since
 * GoogleAnalytics.tsx disables GA's own automatic pageview
 * (send_page_view: false) specifically so this is the ONLY source of
 * pageviews, this component covers the initial load too, not just
 * subsequent client-side navigations.
 *
 * useSearchParams() requires a Suspense boundary in the App Router
 * (the same requirement already established elsewhere in this app —
 * see join/[code]/page.tsx's own identical comment for useParams) —
 * wrapped here so this component is a safe, self-contained drop-in
 * with no special handling required at its one call site
 * (layout.tsx).
 */
function RouteChangeTrackerInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const query = searchParams?.toString()
    trackPageView(query ? `${pathname}?${query}` : pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()])

  return null
}

export default function RouteChangeTracker() {
  return (
    <Suspense fallback={null}>
      <RouteChangeTrackerInner />
    </Suspense>
  )
}
