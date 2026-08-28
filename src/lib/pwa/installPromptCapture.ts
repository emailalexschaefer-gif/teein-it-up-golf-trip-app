/**
 * P0 field-test fix — "Add to Home Screen: reset works, but the prompt
 * never comes back."
 *
 * Root cause: `beforeinstallprompt` fires exactly ONCE per page load,
 * and only if the browser has already determined the page is
 * installable at that moment — but the only place that ever listened
 * for it (useInstallPrompt, inside InstallPwaCard) was mounted deep
 * inside the trip Lobby page, reached only after login → trip list →
 * a specific trip's several navigations. By the time that listener was
 * attached, the event had almost always already fired (Chrome fires it
 * early, often on the very first render) and gone unheard — resetting
 * the dismissal flag correctly cleared our own localStorage state, but
 * `platform` could still never become 'android-supported' for that
 * page session, because no `deferredPrompt` was ever captured to hand
 * back.
 *
 * Fix: a plain module-level singleton, populated by a listener attached
 * as early as physically possible — the root layout (src/app/layout.tsx),
 * which every single page renders through, including login and the trip
 * list, well before any player ever reaches the Lobby. Once captured,
 * the same event is available to any component that asks, no matter
 * when it mounts — this is what a reset now actually reconnects to.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let capturedEvent: BeforeInstallPromptEvent | null = null
let alreadyInstalled = false
const listeners = new Set<() => void>()

export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
  return capturedEvent
}

export function wasAlreadyInstalledAtCaptureTime(): boolean {
  return alreadyInstalled
}

// Any mounted useInstallPrompt() instance can subscribe to be notified
// the moment a later-arriving event is captured (covers the case where
// this module's own listener and a consuming component both mount in
// the same page load, in either order).
export function subscribeToInstallPromptCapture(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function clearCapturedInstallPrompt() {
  capturedEvent = null
}

let initialized = false

/**
 * Call once, as early as possible (root layout). Idempotent — safe to
 * call again if React Strict Mode or a remount tries twice.
 */
export function initInstallPromptCapture() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true
  if (isStandalone) { alreadyInstalled = true; return }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    capturedEvent = e as BeforeInstallPromptEvent
    listeners.forEach(fn => fn())
  })

  // If the app is installed later in this same session (user accepts a
  // native prompt triggered some other way), the captured event is no
  // longer usable — clear it so a stale reference isn't handed out.
  window.addEventListener('appinstalled', () => {
    capturedEvent = null
    alreadyInstalled = true
    listeners.forEach(fn => fn())
  })
}
