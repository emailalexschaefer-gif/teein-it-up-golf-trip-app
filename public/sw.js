/**
 * Teein' It Up — service worker.
 *
 * 30 Aug field-test bundle — PWA installation bug (Samsung/Android).
 * Root cause, confirmed by inspection: this file did not exist at all,
 * anywhere in the project — no manual implementation, no next-pwa/
 * workbox plugin, nothing. A manifest with correct name/icons/display/
 * start_url alone is NOT sufficient for Chrome on Android to offer the
 * real "Install" experience — a registered service worker with a
 * fetch handler is part of Chrome's own installability criteria.
 * Without one, Chrome correctly determines the site doesn't qualify
 * and falls back to "Create shortcut" instead, which does not use the
 * manifest's icons at all — that's the actual explanation for the
 * generic grey icon, not a manifest or icon-file problem (both were
 * already correct).
 *
 * Deliberately minimal and conservative, given this is a live-scoring
 * app with real-time data — this must never risk serving a stale
 * score, leaderboard, or event page from cache. Scope is intentionally
 * narrow:
 *   - Caches ONLY static, versioned-by-filename assets (icons, the
 *     manifest itself, fonts) with a cache-first strategy — safe,
 *     because these genuinely don't change without a new deployment
 *     recreating this whole worker anyway (see CACHE_NAME below).
 *   - Every navigation request (HTML pages) and every /api/* request
 *     passes straight to the network, uncached, always — scoring data,
 *     leaderboards, chat, everything dynamic is completely untouched
 *     by this worker. No offline-first shell, no stale-while-
 *     revalidate for anything that could show outdated event data.
 *   - No push notifications, no background sync — genuinely just the
 *     minimum real, useful implementation needed to satisfy Chrome's
 *     installability bar without introducing any staleness risk to a
 *     live app.
 */

const CACHE_NAME = 'teeinitup-static-v1'

const STATIC_ASSET_PATTERNS = [
  /^\/brand\//,
  /^\/manifest\.json$/,
  /^\/favicon/,
  /^\/icon-/,
]

function isStaticAsset(pathname) {
  return STATIC_ASSET_PATTERNS.some(pattern => pattern.test(pathname))
}

self.addEventListener('install', (event) => {
  // Activate immediately rather than waiting for every open tab to
  // close — this app is frequently opened fresh from a Home Screen
  // icon rather than kept open in a long-lived tab, so the usual
  // "wait for next visit" caution matters less here, and getting a
  // fixed manifest/icon update live sooner is more useful than not.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only ever handle GET requests for our own origin's static assets.
  // Everything else — every navigation, every /api/* call, every
  // Supabase request, any cross-origin request — falls through
  // untouched to the browser's normal network handling. This fetch
  // handler existing at all (even this narrowly scoped) is what
  // satisfies Chrome's installability requirement; it is deliberately
  // NOT an attempt to make this app work offline.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (!isStaticAsset(url.pathname)) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
