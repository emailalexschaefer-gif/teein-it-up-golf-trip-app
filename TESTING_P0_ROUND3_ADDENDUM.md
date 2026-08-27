# P0 Round 3 — Close Round, Side Game Verification, Scroll Fix
## 2026-08-27 (evening)

Real-device testing confirmed Round 2's persistence fixes worked:
Marnie's scores now persist correctly, both scorecards are in the
right sequence, and My HQ correctly reports 2 Finished / 100% Complete
/ 0 Reconciling. Per your instruction, none of that was revisited here.

Three new issues, tackled in the priority order you gave: Close Round
first, Side Game verification second, scrolling third.

## 1. Close Round producing no visible response — FIXED (my own regression)

**Root cause:** the `useEffect` added in Round 2 to clear a stale
`closeError` was checking the wrong thing. It cleared the error
whenever `data.summary.completionPct === 100 && awaitingReconciliation
=== 0` — but that's the round's *scoring* completeness (from the My HQ
tournament query), not whether the Close Round *request itself*
succeeded. Since the round genuinely was 100%/0-reconciling, that
effect fired on the very next render after any real error was set,
clearing it before it could ever be seen. A genuine 409 or 500 from
the close endpoint would flash and vanish within one render cycle —
exactly "click Close Round → nothing visibly happens."

**Fix:** removed that `useEffect` entirely (and the now-unused
`useEffect` import). `handleClose` already clears `closeError` at the
start of every new attempt, which is sufficient — there's no need for
a separate auto-clear, and the auto-clear was actively harmful.

**What I did NOT do, per your explicit instruction:** did not touch
round-eligibility logic (`checkRoundCompletion`,
`detectSharedDeviceGroup`, or the close route's own completion gate).
I re-read `close/route.ts` end-to-end and found every branch already
returns a well-formed JSON response (401/403/404/409/500/200) — no
other bug found there. The masking `useEffect` is the most complete
explanation I have for the reported symptom; if a genuine server error
still occurs after this fix, it should now actually surface, and the
existing `[close-round blocked]` console log (from Round 2) will show
the debug payload.

**Not yet verified:** I could not click the actual button in a
browser. Please confirm on-device that clicking Close Round now either
(a) succeeds and transitions into the post-round snapshot flow, or (b)
if it still fails, shows a visible red error message that doesn't
disappear.

## 2. Shared-device Side Game verification — genuine gap, now built

Traced two separate problems, both real:

**a) Marnie's required verifications never surfaced to anyone.** The
pending-verifications query filtered strictly on `required_verifier_id
= user.id`. Since Marnie has no account/session of her own, this
condition could never be satisfied by any real login — so a claim
requiring her verification simply never appeared in anyone's "awaiting
verification" list, on any device, ever. Fixed by widening the query
(only when `?roundId=` is supplied, which is how the scoring shell
always calls it) to also include claims whose `required_verifier_id`
is the caller's shared-device paper partner for that specific round —
detected via the same `detectSharedDeviceGroup` function used
everywhere else, not a new copy of the rule. Each such claim is
flagged `verifyingAsPartner: true` with the actual verifier's name, so
the client can render it distinctly rather than as the caller's own
claim.

**b) Even once surfaced, verifying would have failed.** The verify
endpoint always called the underlying RPC with `p_verifier_id =
user.id` (the authenticated caller). Since the RPC's own authority
check requires `p_verifier_id` to equal the claim's snapshotted
`required_verifier_id`, and that's Marnie's id (not Alex's, whichever
account is actually calling), this would have failed with "Only the
assigned verifier" every time. Fixed with a narrow, explicitly
server-validated exception — never trusted from the request body:
only when the caller is independently confirmed (same detection
function again) to be the digital half of a genuine shared-device pair
with this specific claim's actual required verifier, the RPC is called
with her id instead of the caller's own. This reuses the existing
verification RPCs and backend entirely, per your instruction — no new
verification logic, just a different, validated `p_verifier_id`. Both
the physical caller and the identity used for verification are logged
together for audit.

**UI:** `PendingVerificationCard.tsx` now shows "✏️ Marnie to verify —
hand over the phone" and relabels the confirm button "✓ Marnie
confirms this result" for these claims — matching your specified
copy, never auto-verified.

**Reverse direction (Marnie's claim → Alex verifies) needed no
changes.** Since Alex has a real account, if the marker-resolution
hierarchy in migration 047 already names him as the required verifier
for a claim entered on Marnie's behalf, the *existing*, unmodified
verify path already works — his own `user.id` already equals
`required_verifier_id` in that case. This should already work today,
but hasn't been seen on a real device — see acceptance list below.

**Real uncertainty I want to flag:** all of this depends on
`round_markers` actually pairing Alex and Marnie with each other for
this round — I could not query production data to confirm this
pairing exists for a shared-device group specifically (round_markers
predates the shared-device feature entirely). If it turns out
shared-device groups don't get a `round_markers` row at all, the
verifier-resolution hierarchy in migration 047 would fall through to
the organiser or another co-player instead of Marnie/Alex, and the
claim would need to be verified by whoever that resolves to — my fix
here only handles the case where the resolved verifier genuinely *is*
the shared-device partner. This is worth checking directly (does a
Longest Drive claim in a shared-device round actually surface with
`verifyingAsPartner: true`, or does it not show up for Alex at all).

## 3. Scroll / sticky-footer unreachable content — fixed via measurement, not padding

Per your instruction not to fix this with an arbitrary large padding
value, I didn't guess a number. Instead:

- Added a `ResizeObserver` on the actual fixed action tray
  (Confirm/Previous/Next), which reports its real rendered height.
- Reserve exactly that measured height as trailing space at the true
  end of the scrollable content (a spacer sized to `actionTrayHeight`,
  placed immediately before the tray in the DOM).

This self-corrects for every state that changes the tray's actual
height — the sync-status label appearing/disappearing, the
shotgun-mode extra "Round Summary" button, safe-area differences —
without the code needing to know about any of those states
individually, and regardless of which horizontal scorecard(s) are
expanded. Expanding a scorecard just makes the page's natural content
taller, which native document scroll already handles correctly on its
own; the actual bug was that the reserved trailing space could be
smaller than the tray itself in some of its states. Measuring the real
thing removes that class of bug entirely rather than patching one
specific instance of it.

I searched exhaustively for a CSS/JS-level scroll cap (overflow:hidden,
fixed height, a scroll-locking effect) that could explain a harder
version of this bug and found none — the app's own `min-h-screen`
layout and this page's normal document flow should already let content
grow freely. If the on-device test still shows unreachable content
after this fix, that would mean there's a real scroll-capping mechanism
I haven't found, and it's worth sending me the exact device/browser and
whether it reproduces in a normal desktop browser window too (to rule
out a mobile-Safari-specific viewport quirk, e.g. address-bar
collapse behavior, which behaves differently from what I can reason
about without a real device to test on).

## Build/test status — same caveat as every round today

**`npm run build` was not run** — still no network access in this
sandbox. Six files touched this round (`TournamentControl.tsx`,
`SelfMarkerScoreShell.tsx`, `PendingVerificationCard.tsx`,
`pending-verifications/route.ts`, `verify/route.ts`, plus re-verifying
`close/route.ts` unchanged) were all syntax-checked with the
TypeScript parser directly — zero errors across all of them. This
doesn't replace a real build or type-check against the actual
Next.js/Supabase types, which this sandbox can't install
(`npm install` returns 403). **Run `npm run build` before this ships.**

No business-logic file in `src/lib/scoring/**` was touched this round,
so the 224/224 pure-function test result from earlier rounds still
stands unchanged.

## Acceptance checklist for this round

1. **Close Round** (highest priority, per your instruction): on the
   already-ready round from these screenshots, click Close Round.
   Confirm it now either succeeds (transitions to the snapshot/post-
   round flow) or shows a visible, persistent error.
2. **Side Game verification, both directions:**
   - Alex submits a Longest Drive/NTP claim → confirm it now appears
     as "Marnie to verify" somewhere reachable by Alex (the
     `PendingVerificationCard` in the scoring shell) → tap "Marnie
     confirms this result" → confirm it becomes verified and appears
     correctly in Side Games/leaderboard.
   - A claim entered on Marnie's behalf (the existing "Result for:"
     proxy-entry dropdown) that requires partner verification → confirm
     Alex can verify it normally (this path should need no changes, but
     hasn't been confirmed on-device).
3. **Scrolling:** expand Alex's scorecard, expand Marnie's scorecard,
   expand both — in every combination, confirm you can scroll far
   enough to see and use Live Leaderboard and Pro Tip, with the sticky
   footer never covering the last piece of content.
4. **Regression:** a genuine 2-digital-players/2-devices round should
   still require real cross-device verification for Side Games (no
   shared-device path should ever trigger for a non-shared-device
   pair), and Close Round should behave identically to before for that
   round type.
