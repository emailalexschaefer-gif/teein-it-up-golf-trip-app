'use client'

import Script from 'next/script'

/**
 * GA4 base integration — Next.js's own officially documented pattern
 * for third-party scripts (`next/script`, strategy="afterInteractive"),
 * not the older raw `<script>`-in-`<head>` approach the demo may have
 * used — confirmed by repo-wide search that no prior GA/GTM
 * implementation exists to preserve or migrate from.
 *
 * Fails safe: if NEXT_PUBLIC_GA_MEASUREMENT_ID isn't set (local dev,
 * or before Alex provides the production ID), this renders nothing at
 * all — no script tag, no network request, no console noise. The rest
 * of the app never needs to know whether GA is configured; trackEvent()/
 * trackPageView() (src/lib/analytics/trackEvent.ts) already no-op
 * safely either way.
 *
 * send_page_view: false is the critical setting for a Next.js App
 * Router app specifically — GA's own default automatic pageview fires
 * exactly once, on this script's initial load, and has no way to know
 * about a client-side route change afterward (there's no full page
 * load to hook). Leaving the default on would mean every subsequent
 * in-app navigation goes completely untracked. Pageviews are instead
 * sent exclusively via trackPageView(), called from
 * RouteChangeTracker.tsx on every route change including the first —
 * one single path for every pageview, avoiding the duplicate-pageview
 * problem (automatic + manual both firing for the same navigation)
 * this exact setup is otherwise prone to.
 */
export default function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  if (!measurementId) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${measurementId}', { send_page_view: false });
        `}
      </Script>
    </>
  )
}
