# PLAYER LOBBY / SMART PWA INSTALL EXPERIENCE
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 5 files
touched were syntax-checked directly — **zero errors**. Full
pure-function suite re-confirmed unaffected: **310/310 pass**. Nothing
here touches scoring logic.

---

## What was already in place vs. what was built this round

The genuine `beforeinstallprompt`/native-install flow (item 3) already
existed from earlier work and is **preserved exactly as-is** — same
global capture mechanism, same `promptInstall()` call, unchanged. This
round's work is entirely about making it a genuinely smart, complete
button (handling every platform, not just the one that was already
verified working) and about placement/copy/analytics polish.

## 1. Install section moved near the top of the Lobby onboarding

Moved `InstallPwaCard` to render **before** the Welcome Brochure,
rather than after it — the first thing a player sees on arriving at
the Lobby, matching "near the top of that experience." Rewrote the
copy to your exact suggested structure: eyebrow label, headline, the
four-item checkmarked feature list, the primary button, and the "Takes
about 10 seconds" note. Still a normal inline card, never a blocking
screen — nothing about the required
`Join → Lobby → Install recommendation → Explore` journey was changed
architecturally, only the card's position within a screen a player
could already fully use without it.

## 2. One smart button

`handleInstall()` is the single entry point the player ever taps —
they're never shown or asked to choose Android vs. iOS vs. anything
else. It branches internally on whatever `useInstallPrompt` has
already determined, matching item 2's "the application determines
what happens next" exactly.

## 3. Android/Chrome — preserved exactly

**Not touched.** The `platform === 'android-supported'` branch still
calls the same `promptInstall()` → `deferredPrompt.prompt()` path that
was already verified working on a real Samsung device. Per your
explicit instruction not to replace this, it wasn't.

## 4. iOS — instruction sheet, unchanged from earlier work, now reused for fallback too

The existing iOS instruction sheet (Share → Add to Home Screen → Add)
is unchanged. Its steps array is now selected based on platform
(`ios-safari` vs. `fallback`) rather than being iOS-only — see below.

## 5. Fallback browsers — the actual gap this round closes

**Found the real gap:** `useInstallPrompt`'s platform detection
previously only recognized three end states — `android-supported`,
`ios-safari`, or `installed` — with everything else permanently
collapsing to `unsupported`, which `InstallPwaCard` treated as "hide
the whole section." That means Android Firefox, Samsung Internet (in
configurations where `beforeinstallprompt` doesn't fire), and any
other non-matching browser got **zero install guidance at all** —
directly violating "the button must never silently fail."

**Fix:** added a genuine `fallback` platform state. Any browser that
isn't iOS Safari and never received a real `beforeinstallprompt` now
gets generic, still-actionable instructions ("Open your browser's menu
→ look for Add to Home Screen or Install App → confirm") via the same
instruction-sheet UI already built for iOS, rather than being hidden
entirely. Per the explicit "prefer feature/capability detection"
instruction: the Android path is still purely capability-based (did
the browser actually fire the event, never "is this Chrome"); the one
UA-based branch that remains (iOS Safari vs. everything else on iOS)
is the case the brief itself explicitly allows for — iOS has no
feature-detectable signal for "can this browser add to home screen,"
only Safari genuinely can.

## 6. Already installed — unchanged behaviour, now paired with a broader trigger

`platform === 'installed'` still returns `null` immediately — the
entire section disappears, not a disabled version of it. This
detection itself (`display-mode: standalone` + the legacy iOS
`navigator.standalone` flag) was already correct and untouched; it's
just reached from more platform branches now that `fallback` exists
alongside `android-supported`/`ios-safari`.

## 7. Lobby never blocked

Not applicable as a code change — `InstallPwaCard` was never a gate
around any other Lobby content and remains a normal, dismissible
inline card. Confirmed by inspection that everything else on the
Lobby page (playing group, trip info, Chat, event exploration) renders
completely independently of this component's state.

## 9. Did not touch scoring reliability

Confirmed by inspection: nothing in today's change set is anywhere
near the offline queue, hydrate effects, or any scoring persistence
code. The explicit "installing must not become a workaround for
browser state problems" requirement holds by simply not touching any
of that code, not by anything new being added to compensate for it.

## 10. Analytics hooks

Built `src/lib/analytics/trackEvent.ts` — a thin, named-event
abstraction (not ad-hoc string literals scattered at each call site),
so the whole funnel is readable from one file and swapping in real
GA4 calls later is a one-file change, not a hunt through the codebase.
Wired in at every funnel point this component can see:
`install_prompt_shown` (fires once, the moment the card first becomes
genuinely visible — never for installed/dismissed players),
`install_button_tapped`, `install_accepted` (Android native path),
`install_instructions_shown` (iOS/fallback), `install_dismissed`.
`invite_opened`/`join` are outside this component's own scope (they
belong to the join/signup flow, not the Lobby) — declared as named
event types ready to wire in at their actual call sites when that
flow gets touched, not implemented speculatively in code paths this
round didn't otherwise need to change.

---

## FILES CHANGED

- `src/lib/pwa/useInstallPrompt.ts` — added the `fallback` platform
  state
- `src/lib/analytics/trackEvent.ts` (new) — funnel event abstraction
- `src/components/trips/InstallPwaCard.tsx` — new copy, fallback
  instructions, analytics hooks
- `src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx` — repositioned
  above the Welcome Brochure

## MIGRATIONS REQUIRED: No.

## TESTS

No new automated tests — this is client-side platform
detection/UI/analytics-stub logic, not suited to the existing
pure-function suite. Full existing suite re-confirmed unaffected:
**310/310 pass.**

---

## What still needs a real device

Everything platform-detection-related in this round is new logic
(the `fallback` state didn't exist before) and has not been exercised
on any real browser from this sandbox:
- Android Chrome — should be unaffected (unchanged code path), worth a
  quick re-confirmation given the surrounding file changed.
- iOS Safari — same instruction sheet as before, now selected via a
  slightly different condition; worth reconfirming.
- A genuine fallback browser (e.g. Android Firefox, or Samsung
  Internet if it doesn't fire `beforeinstallprompt` in your test
  environment) — **this is the one genuinely new behaviour with no
  prior real-device confirmation at all.**
- Already-installed suppression — unchanged logic, should still hold.
- Dismiss/"Maybe later" persistence — unchanged logic, should still
  hold.
