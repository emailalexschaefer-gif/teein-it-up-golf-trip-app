'use client'

import { useEffect } from 'react'

/**
 * 30 Aug field-test bundle — PWA installation bug. Registers the
 * minimal static-asset service worker (public/sw.js) — see that file
 * for the full root-cause trace of why this needed to exist at all.
 * Mounted once at the true app root (layout.tsx), same pattern already
 * established for InstallPromptCaptureInit — every page needs this
 * registered, not just specific ones, since installability is a
 * property of the whole site, not one route.
 *
 * No-ops safely in any environment without service worker support
 * (older browsers, some in-app webviews) — `'serviceWorker' in
 * navigator` is the standard feature-detection guard, not a
 * browser-sniffing hack.
 */
export default function ServiceWorkerInit() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(err => {
      // Non-fatal — the app itself must never depend on this
      // succeeding; a failed registration just means this particular
      // browser session won't get the installability benefit this
      // round, not a broken app.
      console.error('[sw] registration failed', err)
    })
  }, [])
  return null
}
