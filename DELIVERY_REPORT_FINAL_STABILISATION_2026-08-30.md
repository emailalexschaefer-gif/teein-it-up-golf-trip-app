# TEEIN' IT UP — OUTSTANDING BUGS / FINAL STABILISATION
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 3 files
touched today were syntax-checked directly with the TypeScript
compiler — **zero errors**. Full pure-function suite: **310/310 pass**
(251 scoring + 59 highlights), unchanged — nothing touched today is a
pure-function library.

Per the explicit instruction, the only item with new work this round
is P0 (Password Reset Landing Screen) — the only newly-confirmed bug
in this bundle. Everything else (Hole 10, Live Sync, Side Game Moment)
already has a code fix from the previous round and is correctly listed
as needing live-device acceptance, not further code changes; P2 is
verify-only and already satisfied; the Playing Partner regression item
is explicitly "don't touch." **I did not modify any of that code this
round.**

---

## P0 — Password Reset Landing Screen (the only new bug)

**Root cause, traced exactly per the requested chain** (Supabase
recovery email → redirect URL → auth callback/session →
PASSWORD_RECOVERY state/event → recovery UI → `updateUser`):

The app has two possible landing points for a recovery link: the
server-side PKCE route (`/api/auth/callback`, used when Supabase
delivers a `?code=`) and a client-side implicit-flow fallback
(`/auth/callback`, used when it doesn't — a hash-fragment token
instead). Found two real, independent bugs in the second path, plus
one architectural weakness common to both:

1. **A genuine, provable param-name mismatch.** `/api/auth/callback`
   forwards its original query string verbatim to `/auth/callback`
   when there's no `code` — that string carries `next=/reset-password`
   (the actual param this app's own reset flow sets). But
   `/auth/callback` read `redirectTo`, a param that was never actually
   present. Every implicit-flow recovery arrival silently fell through
   to the `/dashboard` default, never `/reset-password`.
2. **A timing race.** Detection used a blind `setTimeout(..., 500)`
   before checking `getSession()`, rather than waiting for a genuine
   signal that the session was ready. If the check lost the race, the
   `else` branch fired: `router.replace('/login?error=auth_failed')` —
   this is the exact reported symptom, "opens the normal Sign In /
   Create Account screen."
3. **Architectural weakness in both landing points:** neither
   `/auth/callback` nor `ResetPasswordForm.tsx` ever checked for
   Supabase's specific `PASSWORD_RECOVERY` auth event — both just asked
   "is there any active session at all," which cannot distinguish a
   genuine recovery session from an unrelated already-logged-in one,
   and (for the implicit path) is exactly what made the timing race in
   #2 possible in the first place.

**Also found:** neither file checked for Supabase's error-hash format
(`#error=...&error_code=...&error_description=...`), which is how an
expired or already-used recovery link actually reports itself — it was
silently treated as "no session," with no explanation to the user at
all, missing the explicit "useful expired/invalid-link error"
requirement entirely.

**Fix:**
- `auth/callback/page.tsx` — reads both `next` and `redirectTo` (fixes
  the mismatch, tolerant of either). Replaced the blind timer with
  `onAuthStateChange`, listening for `PASSWORD_RECOVERY` (and
  `SIGNED_IN`, for the other implicit-flow cases this page still
  handles) — a real signal instead of a guessed delay. A bounded
  4-second fallback remains only for the genuinely-dead-link case where
  no event will ever fire. Added explicit hash-error detection with a
  dedicated "Link expired" screen and a direct path back to request a
  new one.
- `ResetPasswordForm.tsx` — now listens for `PASSWORD_RECOVERY`
  specifically via `onAuthStateChange`, the Supabase-documented
  canonical pattern for this exact scenario, rather than a generic
  "any session" check. Still checks `getUser()` immediately on mount
  for the common case where the PKCE route already finished the
  exchange before this page loaded — using the functional `setState`
  form so a late-resolving check can't stomp on a state the event
  listener already correctly set. Added the same expired-link hash
  detection, surfaced as a message directly on the request screen.
- `LoginForm.tsx` — small, additive fix: the very last-resort fallback
  (`/login?error=auth_failed`, only reached if no auth event ever
  fires at all) previously landed on a silent plain login screen; now
  shows a useful message. Does not touch signup, does not re-enable
  email confirmation, does not touch anything else on this page.

**Explicitly confirmed unaffected by this fix:** signup still sends no
confirmation email (nothing in the signup code path was touched), and
`resetPasswordForEmail` itself (already working, confirmed "GOOD" in
the brief) is unchanged — this fix is entirely about what happens
*after* the email is delivered and the link is tapped, not the sending
of it.

**Acceptance checklist status — code-level only, not yet live-tested:**
- [x] New Password field — already present, unchanged
- [x] Confirm Password field — already present, unchanged
- [x] Passwords must match — already present, unchanged
- [x] Minimum password validation (8 chars) — already present, unchanged
- [x] Loading state — already present, unchanged
- [x] Useful expired/invalid-link error — **new this round**, both
      landing points
- [~] Successful update exits recovery mode — unchanged code path
      (`router.push('/dashboard')` after `updateUser` succeeds);
      **not re-tested**
- [~] New password subsequently works / old password no longer works —
      pure Supabase Auth behaviour, not something this app's code
      controls either way; **not verified live**
- [ ] **The core fix itself — recovery link opens Reset Password, not
      Sign In — not verified live.** This is the one that actually
      matters and the one I cannot confirm from this sandbox.

---

## P0 — Hole 10 / Back-Nine Start

**No code changes this round**, per your explicit instruction that this
already has a code fix from the previous bundle and now needs live
acceptance, not more inspection. Re-reading the brief's own framing:
"DO NOT close this bug based on code inspection" — agreed, and nothing
here claims it's closed. Status unchanged: implemented, traced,
diagnostic logging in place in `holes/route.ts`, **awaiting the fresh-
round live acceptance checklist in your brief.**

## P1 — Live Score Synchronisation

**No code changes this round.** Polling, manual refresh, and the
unsaved-draft-preservation fix from the previous bundle are unchanged.
**Awaiting two-device live acceptance.**

## P1 — Side Game Photo + Lead Change

**No code changes this round.** The proxy/organiser authorization fix
from the previous bundle (`moments/route.ts`) is unchanged. **Awaiting
live acceptance** across all three listed submission paths (player,
organiser-who-is-playing, proxy/same-group).

## P2 — Round Setup Information

**Verify only, per your instruction.** Starting Hole is already in the
setup summary (previous bundle). Confirmed the other five items were
already present before that: Group, Tee Time, Players, Final Playing
Handicaps, and Exact/Raw HCP vs Daily HCP basis (the round setup flow
already surfaces this distinction in its handicap step — not modified,
not re-verified live this round, just confirmed present in the code by
inspection). No redesign attempted.

## Regression — Playing Partner Auto-Pair

**Not touched.** Confirmed via inspection that nothing in today's three
files (`auth/callback/page.tsx`, `ResetPasswordForm.tsx`,
`LoginForm.tsx`) has any code path anywhere near `round_markers`,
`playing-partner`, or scoring — this is an auth-flow-only change.

---

## FILES CHANGED

- `src/app/auth/callback/page.tsx` — implicit-flow recovery detection
  fix
- `src/app/(auth)/reset-password/ResetPasswordForm.tsx` —
  PASSWORD_RECOVERY-aware detection, expired-link handling
- `src/app/(auth)/login/LoginForm.tsx` — last-resort fallback message

## MIGRATIONS REQUIRED: No.

## TESTS

No new automated tests added — this is auth-flow UI/routing logic
depending on Supabase's own client-side event system
(`onAuthStateChange`), not a pure function suited to the existing
`node --test` suite. Flagged as a real gap, not silently skipped: this
is exactly the kind of flow that's hard to unit test and genuinely
needs the live acceptance pass below. Full existing suite re-confirmed
unaffected: **310/310 pass.**

## FINAL ACCEPTANCE GATE — STATUS

Per your exact gate, marking only what's genuinely resolved vs. what
still needs a live pass:

**AUTH**
- [x] Signup sends no confirmation email — unchanged, confirmed by
      inspection not to have been touched
- [x] Forgot Password sends reset email — already working per your
      brief, unchanged
- [ ] **Reset link opens Reset Password screen — fixed in code this
      round, not yet live-verified — this is the one to test first**
- [ ] New password can be saved — unchanged code path, not re-tested
- [ ] New password works — Supabase behaviour, not re-tested

**SCORING / LIVE SYNC / SIDE GAMES** — all unchanged from the previous
bundle's status: code fixes in place, all still awaiting live
acceptance exactly as your brief describes. Nothing here regressed
(confirmed via the full pure-function suite and via not having touched
any of these files today).

**REGRESSION** — playing partner, Previous/Next, Leaderboard, Side
Games, My HQ, My Golf: unaffected, nothing in today's change set is
anywhere near this code.

## HONEST SUMMARY

One genuinely new bug this round, with a real, traceable root cause
(not a guess) and a fix built on Supabase's own documented pattern for
this exact scenario rather than a workaround. Per your own instruction,
**I am not claiming any live test has passed** — every checkbox above
that requires a real device or a real email inbox is marked as such,
not assumed.
