# GOOGLE ANALYTICS 4 / PRODUCT ANALYTICS FOR TEEIN' IT UP MVP
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 15 files
touched were syntax-checked directly with the TypeScript compiler —
**zero errors**. Full test suite: **318/318 pass** (251 scoring + 59
highlights + 8 new analytics tests).

---

## 1. Audit first, per the explicit instruction

Searched the repo for every term listed (`gtag`, `GoogleAnalytics`,
`GTM`, `GA_MEASUREMENT_ID`, `NEXT_PUBLIC_GA`, `analytics`,
`dataLayer`) before writing anything. Found a comprehensive
implementation already in place from earlier work:

- `src/components/analytics/GoogleAnalytics.tsx` — GA4 script loading
- `src/components/analytics/RouteChangeTracker.tsx` — pageview tracking
- `src/lib/analytics/trackEvent.ts` — the central event layer, with the
  **full event vocabulary already declared** (27 named events)
- All three correctly wired into `src/app/layout.tsx`

**One production analytics architecture, confirmed — nothing
duplicated, nothing rebuilt from scratch.** My work this round was
completing and correcting what already existed, not building a second
system.

## 2. GA4 property / Measurement ID

Already correct: `NEXT_PUBLIC_GA_MEASUREMENT_ID` is documented in
`.env.example` with a clear comment explaining the fail-safe behavior.
`GoogleAnalytics.tsx` returns `null` (no script, no network request at
all) when unset — confirmed by reading the code, not assumed. **Alex
still needs to add the real production Measurement ID to Vercel's
environment configuration** — that's outside anything I can do from
this sandbox.

## 3. Base GA4 integration

Already correct: `next/script` with `strategy="afterInteractive"` (the
current Next.js-recommended pattern for third-party scripts, not the
demo's possible old raw-`<script>` approach — moot anyway, since no
prior demo implementation was found to migrate from).
`send_page_view: false` is set specifically so GA's own automatic
pageview (which only fires once, on script load, and has no way to
observe a client-side route change) never fires — `RouteChangeTracker`
is the **only** pageview source, avoiding the duplicate-pageview
problem the brief explicitly named. Fires on the initial load too, not
just subsequent navigations.

## 4. Central analytics layer

Already correct and exactly as specified: `trackEvent(name, props)` +
`trackPageView(path)`, nothing calls `window.gtag()` directly from any
component. Fails safe twice over — no-ops if the measurement ID isn't
set, and every call is wrapped in try/catch so a blocked/failing
script can never surface as an application error.

## 5. Privacy / PII — found and fixed a real, concrete violation

This is the one genuine bug found this round, not just verification of
existing work. `RouteChangeTracker` was sending `pathname + query
string` to GA4 completely unmodified. Two real leaks:

- The invite code is a **dynamic URL path segment** on `/join/[code]`
  (`usePathname()` returns it verbatim — there's no way to avoid
  seeing it structurally, only to redact it before sending).
- The invite code also appears as `?inviteCode=` on the login and
  signup pages when arriving from an invite link.

Both are explicitly prohibited under this brief's own "invitation
tokens" rule. Fixed with `sanitizePagePath()` — a narrow, explicit
redaction (the `/join/[code]` segment specifically, plus a fixed list
of known-sensitive query param names: `inviteCode`, `code`, `token`,
`access_token`, `refresh_token`, `redirectTo`, `next`) rather than a
blanket strip-everything approach, which would also have thrown away
genuinely useful non-PII context like `?mode=password`. **8 new tests**
cover this directly, including the specific "redact the sensitive
param, keep the harmless one on the same page" case. All pass.

Every other explicit PII prohibition (names, emails, chat text, Moment
captions, auth tokens) was already correctly enforced by
`AnalyticsEventProps`' type signature (`string | number | boolean`
only, no nested objects) and by inspecting every property actually
passed at every call site added this round — none pass free text,
only opaque IDs, enums, booleans, and counts.

## 6. Core player funnel events — completed, not just declared

Found the type union already had the full requested vocabulary
declared, but roughly 17 of 27 events had **zero real call sites** —
declared and never fired, the same pattern found and fixed for
`invite_opened`/`join` in an earlier round. Wired every remaining one
into a genuine, checked call site this round:

| Event | Where | Fires on |
|---|---|---|
| `scorecard_opened` | both scoring shells | mount |
| `scoring_started` | both scoring shells | first successful save only (ref-guarded) |
| `score_confirmed` | both scoring shells | every successful hole save |
| `leaderboard_opened` | `LiveLeaderboard.tsx` | mount |
| `side_game_claimed` | `SideCompEntryPanel.tsx` | server-confirmed claim accepted |
| `moment_captured` | `MomentCapture.tsx` | server-confirmed post |
| `my_golf_opened` | `MyRoundClient.tsx` | mount |
| `event_story_opened` | `MyGolfEventStory.tsx` | only once genuine content is about to render (split into an inner component specifically so mount-then-immediately-null doesn't fire it) |
| `round_completed` | `TournamentControl.tsx` | round close server-confirmed |
| `event_completed` | `FinalEventResults.tsx` | final results successfully load (see honest limitation below) |

Per the explicit "do NOT create excessive noisy events" — none of
these fire on keystrokes, drafts, or intermediate UI state; every one
is a genuinely completed action or a deliberate one-per-mount view
event.

**Honest limitation on `event_completed`:** there's no dedicated
server-side "trip just transitioned to complete" signal to hook. This
fires whenever `FinalEventResults` successfully loads — which includes
every repeat view of an already-completed event, not only the one
moment it first became complete. Ref-guarded to fire once per page
mount (not on every background refetch), but still an
over-counting risk across separate visits. Flagged directly in the
code comment, not silently shipped as if it were precise.

## 7. Organiser events — completed

The brief's own text was cut off mid-section ("EVENTS ARE"), so I used
the type union's own already-declared organiser event list (a
reasonable, complete-looking set matching this app's actual round
lifecycle) rather than guessing beyond it:

| Event | Where | Fires on |
|---|---|---|
| `trip_created` | `trips/new/page.tsx` | server-confirmed trip creation (not the edit-trip path) |
| `round_setup_started` | `BeginRoundModal.tsx` | modal opens |
| `round_released` | `BeginRoundModal.tsx` | Starting Grid published |
| `round_started` | `BeginRoundModal.tsx` | round genuinely begun |
| `round_closed` | `TournamentControl.tsx` | same success point as `round_completed` |
| `my_hq_opened` | `MyHQClient.tsx` | mount |
| `makers_breakers_published` | `MakersBreakers.tsx` | server-confirmed publish |

---

## FILES CHANGED

- `src/lib/analytics/trackEvent.ts` — PII fix (`sanitizePagePath`)
- `src/lib/analytics/trackEvent.test.ts` (new) — 8 tests
- 13 component/route files across scoring, moments, side games, My
  HQ/My Golf, round setup, and trip creation — each adding a real
  `trackEvent()` call site, listed individually above

## MIGRATIONS REQUIRED: No.

## TESTS

8 new tests (`trackEvent.test.ts`), all passing, covering the PII
sanitizer specifically — the one piece of genuinely new logic this
round, versus event-call-site wiring, which isn't itself unit-testable
in isolation the way a pure function is. **Full suite: 318/318 pass**
(251 + 59 + 8), confirmed unaffected by every wiring change.

---

## VERIFICATION — CODE-LEVEL ONLY, NOT LIVE-TESTED

**Verified directly:** every one of the 27 declared events now has at
least one real call site (checked via direct grep across the entire
`src/` tree, not assumed from memory of what I added). All 15 touched
files syntax-check clean. The PII sanitizer's exact behavior is
covered by real, passing tests, not just reasoned about.

**Cannot verify from this sandbox:**
- Whether events actually arrive in a real GA4 property — needs
  Alex's production Measurement ID in Vercel, and a live browser
  session with GA4 DebugView or the Network tab open.
- Whether `.env.example`'s documented variable has actually been added
  to Vercel's real environment configuration — that's a deployment
  step, not a code change.
- The actual funnel shape once real player data starts flowing —
  today's work makes the funnel instrumentable end to end, but seeing
  whether it tells the story your brief describes (how players move
  through an event, engagement patterns) needs real usage, not a
  syntax check.

I have not claimed GA4 is "live and receiving data" — only that the
code-level architecture, event coverage, and privacy compliance are
now complete and internally verified.
