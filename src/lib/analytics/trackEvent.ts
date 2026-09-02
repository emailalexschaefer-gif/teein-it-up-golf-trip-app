/**
 * The ONE central analytics layer for Teein' It Up. Every product
 * analytics call in the app flows through trackEvent()/trackPageView()
 * here — nothing calls window.gtag() directly from a component.
 *
 * GA4 / Product Analytics brief — audited the repo first, per the
 * explicit instruction: no gtag, GoogleAnalytics, GTM, dataLayer, or
 * any prior analytics implementation exists anywhere in this project —
 * confirmed by search, not assumed. This file (and its earlier no-op
 * stub) was the only prior analytics work, built ahead of GA4 actually
 * landing specifically so every call site that would eventually need
 * to fire a real event already existed, named and structured. This is
 * that migration — the body of trackEvent()/trackPageView() now
 * actually calls gtag(); no call site anywhere in the app needed to
 * change.
 *
 * Fails safe by design, twice over:
 *   1. If NEXT_PUBLIC_GA_MEASUREMENT_ID isn't set (local dev, or before
 *      Alex provides the production ID), GoogleAnalytics.tsx never
 *      loads the gtag.js script at all — window.gtag simply never
 *      exists, and every call below no-ops via the typeof check.
 *   2. Every call is wrapped in try/catch — a third-party script
 *      failing, being blocked by an ad-blocker, or gtag throwing for
 *      any reason must never surface as an application error. This is
 *      analytics, not a dependency of anything the app needs to work.
 *
 * PII — the actual enforcement mechanism, not just a rule written in a
 * comment: AnalyticsEventProps' index signature only accepts
 * `string | number | boolean`, and every key actually used below is a
 * non-PII product/internal identifier (tripId, roundId, platform,
 * counts, etc. — opaque UUIDs and small enums, never a name, email,
 * free-text field, or token). No call site anywhere in the app should
 * pass player names, chat/Moment text, invite codes, or any auth-
 * related value — grep the codebase for `trackEvent(` before adding a
 * new call site and check every property against this file's own list
 * below before shipping it.
 */

export type AnalyticsEvent =
  // Core player funnel
  | 'invite_opened'
  | 'join_started'
  | 'event_joined'
  | 'lobby_opened'
  // PWA install funnel
  | 'install_offer_shown'
  | 'install_clicked'
  | 'install_completed'
  | 'install_dismissed'
  | 'install_instructions_shown'
  // Scoring
  | 'scoring_started'
  | 'score_confirmed'
  // Navigation / feature usage — "how often is X opened," not every
  // click within it
  | 'scorecard_opened'
  | 'leaderboard_opened'
  | 'side_games_opened'
  | 'side_game_claimed'
  | 'chat_opened'
  | 'moment_captured'
  | 'my_golf_opened'
  | 'event_story_opened'
  // Completion
  | 'round_completed'
  | 'event_completed'
  // Organiser behaviour
  | 'trip_created'
  | 'round_setup_started'
  | 'round_released'
  | 'round_started'
  | 'round_closed'
  | 'my_hq_opened'
  | 'makers_breakers_published'
  // Homepage My Golf achievement summary
  | 'my_golf_summary_expanded'
  | 'my_golf_summary_collapsed'
  // Crucial MVP Onboarding Update
  | 'onboarding_intent_captured'

export interface AnalyticsEventProps {
  // Non-PII product/internal identifiers only — opaque UUIDs, enums,
  // counts. See this file's own header for the actual rule. TypeScript
  // enforces the VALUE types (string | number | boolean, no nested
  // objects a free-text blob could hide inside); it cannot enforce
  // which string a future call site chooses to pass — the header
  // comment and this list are the actual review checklist.
  tripId?: string
  roundId?: string
  roundNumber?: number
  platform?: string
  compType?: string
  holesCompleted?: number
  totalHoles?: number
  isOrganiser?: boolean
  [key: string]: string | number | boolean | undefined
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

export function trackEvent(event: AnalyticsEvent, props?: AnalyticsEventProps) {
  if (typeof window === 'undefined') return
  if (process.env.NODE_ENV !== 'production') {
    // Loud in development, where there's no real GA loaded to check
    // against anyway — this is how every call site has been sanity-
    // checked so far, unchanged from before GA4 existed.
    console.log('[analytics]', event, props ?? {})
  }
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props ?? {})
    }
  } catch {
    // Analytics must never break the app it's measuring — see file
    // header. Deliberately silent; there is nothing actionable a
    // player-facing error could do with a failed analytics call.
  }
}

/**
 * GA4/Next.js App Router — client-side navigations never trigger a new
 * page load, so GA's own automatic pageview (fired once, on initial
 * script load) misses every subsequent route change entirely.
 * GoogleAnalytics.tsx disables that automatic pageview
 * (send_page_view: false) specifically so this is the ONLY place a
 * pageview is ever sent — one path in, no risk of the duplicate-
 * pageview problem the brief explicitly calls out (automatic pageview
 * AND a manual one both firing for the same navigation).
 */
export function trackPageView(path: string) {
  if (typeof window === 'undefined') return
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  if (!measurementId) return
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', { page_path: sanitizePagePath(path), send_to: measurementId })
    }
  } catch {
    // Same fail-safe reasoning as trackEvent above.
  }
}

// GA4 / Product Analytics brief, section 5 — "Do not put PII into...
// page URLs." Found a real, concrete violation while wiring this up:
// the invite-code join flow puts the code directly in the URL PATH
// (/join/ABC123XY, a dynamic route segment — usePathname() returns it
// verbatim, there's no way around seeing it), and several other pages
// (login, signup) carry it as an `inviteCode` QUERY param when arriving
// from an invite link. RouteChangeTracker was sending pathname+query
// straight through to GA4 unmodified — an invite code isn't a password,
// but it's explicitly listed as prohibited ("invitation tokens") in
// this brief's own PII list, and this is the one concrete place that
// rule would otherwise have been broken. Redacts:
//   - the dynamic segment of /join/[code] specifically (the only route
//     in this app that puts a token-like value directly in the path)
//   - a fixed list of known-sensitive query param NAMES, wherever they
//     appear on any page — not a blanket "strip every query string"
//     approach, which would also throw away genuinely useful, non-PII
//     product context like ?mode=password on the login page.
// This is a narrow, explicit allowlist-of-what-to-redact, not an
// attempt at a generic PII scrubber — new sensitive params introduced
// later still need to be added here deliberately, the same way this
// file's own header already asks every new trackEvent property to be
// checked by hand.
const SENSITIVE_QUERY_PARAMS = ['invitecode', 'code', 'token', 'access_token', 'refresh_token', 'redirectto', 'next']

export function sanitizePagePath(path: string): string {
  const [rawPathname, rawQuery] = path.split('?')

  const pathname = rawPathname.replace(/^\/join\/[^/?]+/, '/join/:code')

  if (!rawQuery) return pathname
  const params = new URLSearchParams(rawQuery)
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.includes(key.toLowerCase())) params.delete(key)
  }
  const cleanedQuery = params.toString()
  return cleanedQuery ? `${pathname}?${cleanedQuery}` : pathname
}
