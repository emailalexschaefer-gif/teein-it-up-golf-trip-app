# PLAYER LOBBY / SMART PWA INSTALL EXPERIENCE
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 4 files
touched were syntax-checked directly with the TypeScript compiler —
**zero errors**. Full pure-function suite re-confirmed unaffected:
**310/310 pass**. Nothing here touches scoring/business logic.

---

## Inspected first, per standard practice — most of this brief was already built

Before writing anything, I read `InstallPwaCard.tsx`, `useInstallPrompt.ts`,
and `installPromptCapture.ts` in full. Nearly all of items 1–7 in this
brief already existed from earlier rounds, correctly implemented:

- **One smart button** (item 2) — `handleInstall()` already contains
  all the branching logic; the player never sees or chooses a path.
- **Genuine Android install, deferredPrompt preserved** (item 3) —
  `promptInstall()` still calls the real, already-verified-on-Samsung
  `deferredPrompt.prompt()` API. **Not touched.**
- **iOS instruction sheet** (item 4) — already exists, with iOS-specific
  copy (`IOS_STEPS`), shown only for genuine iOS Safari.
- **Fallback for browsers without `beforeinstallprompt`** (item 5) —
  already exists (`FALLBACK_STEPS`), and the button never silently
  fails — every path either triggers the real prompt or shows
  instructions.
- **Already-installed detection** (item 6) — already uses proper
  feature detection (`matchMedia('(display-mode: standalone)')` +
  iOS's `navigator.standalone`), not user-agent sniffing. Confirmed
  this is genuinely capability-based, not UA-based, per your explicit
  preference.
- **Doesn't block the Lobby** (item 7) — already just a card, never a
  blocking modal; a player can already do everything else without it.
- **Doesn't mask browser-state bugs** (item 9) — the offline queue
  (Dexie-backed `queueScoreEntry`) that scoring already relies on is
  browser-storage-based and behaves identically whether the app is
  running in a normal tab or installed standalone — nothing about
  install status is a dependency for scoring persistence, and nothing
  in this round touched that architecture.

**What was genuinely missing, and is what this round's work actually
addresses:**

## 1. Placement — moved into the Welcome Brochure, near its top

The install card previously rendered as its own separate box directly
above the Welcome Brochure — adjacent to the onboarding experience, not
part of it. Per the explicit "should feel like part of the existing
premium Lobby onboarding experience — not an ugly browser/PWA technical
message":

- **`WelcomeBrochure.tsx`** — `<InstallPwaCard />` now renders inside
  the brochure itself, right after the intro line and before the
  destination tiles grid — genuinely near the top of that card, sharing
  its dark-green premium styling context, not a separate banner bolted
  above it.
- **`PlayerHomeCard.tsx`** — handled the brochure's collapsed state
  correctly: brochure-dismissal and install-dismissal are two
  independent decisions (separate localStorage keys, confirmed by
  reading both components), so collapsing the welcome text must never
  silently also hide the install prompt. When the brochure is
  collapsed, `InstallPwaCard` now renders alongside the collapsed
  summary card instead — never duplicated (it only ever renders in
  exactly one of the two branches at a time), and `InstallPwaCard`
  itself still fully owns its own visibility either way.

## 10. Analytics hooks — found half-wired, completed

`trackEvent()` and its full event vocabulary (`invite_opened`, `join`,
plus the five install-funnel events) already existed as a clean,
GA4-ready abstraction — but `invite_opened` and `join` were declared in
the type and never actually called anywhere in the codebase. Traced the
real join flow to find where they belong:

- **`JoinForm.tsx`** (the actual `/join/[code]` invite-link landing
  page) — `invite_opened` now fires the moment a real invite code is
  confirmed present, before trip/account resolution. `join` now fires
  at each of this file's four `window.location.href =
  buildDoJoinUrl()` hard-navigation points — the earliest
  client-observable signal available, since this path hard-navigates
  to a server route and the client never sees a completion callback.
- **`JoinWelcomeInner.tsx`** (a second, parallel join entry point with
  a genuine client-side mutation) — `invite_opened` and `join` both
  fire here too; `join` specifically inside the mutation's `onSuccess`
  callback, which is a real, server-confirmed success signal, not a
  best-effort pre-navigation guess like the `JoinForm.tsx` case above.

This completes the funnel your brief specifically asked to be
instrumentable: `invite_opened` → `join` → `install_prompt_shown` →
`install_button_tapped` → `install_accepted`/`install_instructions_shown`/
`install_dismissed`. Still fully a no-op today (logs to console only in
development) — swapping `trackEvent()`'s body for a real GA4 call
remains the entire migration whenever that's ready, per its own
existing design; no call site needs to change.

---

## FILES CHANGED

- `src/components/trips/WelcomeBrochure.tsx` — install section moved
  inside, near the top
- `src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx` — handles the
  collapsed-brochure case without duplicating or hiding the install
  prompt
- `src/app/(auth)/join/[code]/JoinForm.tsx` — `invite_opened`/`join`
  wired in
- `src/app/(auth)/join/[code]/welcome/JoinWelcomeInner.tsx` —
  `invite_opened`/`join` wired in

## MIGRATIONS REQUIRED: No.

## TESTS

No new automated tests — this is UI placement and analytics call-site
wiring, not logic suited to the existing pure-function suite. Full
existing suite re-confirmed unaffected: **310/310 pass.**

---

## What I could verify vs. what needs your device

**Verified directly:** all four files parse cleanly; confirmed by
reading the actual component code (not assumed) that install-dismissal
and brochure-dismissal are independent state, and that the collapsed/
expanded branches can't both render `InstallPwaCard` simultaneously;
confirmed the pre-existing Android/iOS/fallback logic and
already-installed detection were not modified.

**Needs your device, per your own required journey:**
- Whether the install section now genuinely reads as "part of" the
  Lobby onboarding card rather than a separate technical banner — this
  is a visual/design judgment call that needs real eyes on a real
  phone, not something I can confirm from a syntax check.
- The actual invitation → join → Lobby → install journey end-to-end,
  confirming no mandatory screen was introduced between joining and
  reaching the Lobby (nothing in this round's changes should have
  introduced one — the install section is still just a card within an
  already-non-blocking Lobby — but this needs a real walkthrough to
  confirm).
- That `invite_opened`/`join` actually appear in the browser console
  (development mode) at the right moments during a real join.
