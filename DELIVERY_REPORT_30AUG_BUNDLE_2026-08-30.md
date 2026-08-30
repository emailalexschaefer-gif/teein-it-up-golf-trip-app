# TEEIN' IT UP — 30 AUG FIELD-TEST BUG BUNDLE
## Delivery Report — 2026-08-30

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All 8 files
touched today were syntax-checked directly with the TypeScript
compiler — **zero errors**. Full pure-function suite: **310/310 pass**
(251 scoring + 59 highlights), unchanged from before today (nothing
touched today is a pure-function library — every fix is in
route/component code).

**Distinguishing code verification from real-device verification,
explicitly, throughout this report:** everything below is a code-level
trace and syntax/test check. This sandbox has no browser and no live
Supabase connection. Nothing here has been clicked through on a real
device.

---

## P0 — Starting Hole / Back-Nine Logic

**Root cause: re-verified, not re-found.** I did not assume yesterday's
persistence fix (wizard payload + Zod schema) was sufficient — I
re-traced the entire downstream chain today, specifically checking the
scoring shell I hadn't previously audited (`ScoreSessionShell.tsx`, the
multi-player group-scoring shell, distinct from
`SelfMarkerScoreShell.tsx`).

**Found:** every navigation, resume, and completion check in **both**
scoring shells is already correctly array-position-based, never
`hole_number`-based:
- `ScoreSessionShell.tsx`'s forward/back navigation
  (`holeIdx < holes.length - 1`), its resume-position scan
  (`findResumePosition`/`circularSearchOrder`), and its own comment
  confirming it has "no order-independent completion trigger of its
  own at all" — round completion is handled entirely server-side
  (`checkScorecardCompletion` in `roundCompletion.ts`), which is a pure
  count comparison (`selfHoleCount < totalHoles`), already completely
  order-agnostic.
- Confirmed `resolvedStartHole` in `ScoreSessionShell.tsx` is only ever
  non-null for genuine Shotgun rounds — a standard Starting-Tee round
  correctly falls through to identity ordering, relying entirely on
  the server already returning `holes` in play order.

**No code bug found in the navigation/completion layer.** Given that,
and given yesterday's note that stale test rounds could still show the
old behaviour, I added a **diagnostic trace** to `holes/route.ts`
(logs the round's actual stored `starting_hole_number` alongside the
resulting play order on every request) so the next test attempt gives
a definitive answer — "still a real bug" vs. "a round created before
the persistence fix" — instead of another round of guessing from a
screenshot.

**File changed:** `holes/route.ts` (trace only, no logic change).

**Not verified on a real device.** Please test against a genuinely
fresh round and check the new trace log if it's still wrong.

---

## P1 — Live Score Auto-Refresh

**Root cause found: a real, significant gap**, not a tuning issue.
`ScoreSessionShell.tsx` received all its scorecard data as static props
from an `async` server component, fetched once per page load — there
was **no client-side refresh mechanism of any kind**. Swiping holes,
tapping buttons, anything client-side never touched this data; only a
full page reload re-ran the server component. This fully explains "the
update only appears after manually swiping/reloading."

**Fix:**
- Added a `useQuery` polling the existing `GET /scorecards` endpoint
  (reused, not a new route) every 8 seconds while the round is active
  — the same cadence already established elsewhere in this app
  (`TournamentControl.tsx`), not a new interval invented for this fix.
  Seeded with the server-rendered props as `initialData`, so there's
  no loading flash on first render — this is additive to the existing
  server render, not a replacement for it.
- Added the explicit `↻ Refresh Scores` fail-safe button, calling the
  same `refetch()`.
- Built `transformScorecardsResponse()`, a client-side function that
  mirrors — not reinvents — exactly what `page.tsx`'s server component
  already does to shape `allGroups`/`groupScorecards` (same sort order,
  same organiser/player branching), so a live poll's data is
  structurally identical to what the server originally sent.

**A second, real bug found and fixed while building this:** the
hydrate effect that populates `scores`/`confirmed` from server+queue
data now runs on every poll (previously ran once). A naive
`setScores(nextScores)` would have **silently erased any in-progress,
not-yet-confirmed score the player was actively entering** — `pick()`/
`pickPar()` write directly into `scores` before "Confirm" is ever
pressed, and a poll's fresh data has no way to know about that
in-progress value. Caught this before considering the fix complete
(the brief explicitly required "doesn't lose unsaved input," so this
needed to actually be checked, not assumed). Fixed by merging: a poll's
fresh data only ever overwrites a value that's *already confirmed*
locally or *newly confirmed* by the fresh data itself — an unconfirmed
in-progress draft is preserved. Added a `confirmedRef` mirror so the
merge can compare against the confirmation state as of just before the
update.

Confirmed the existing `resumedRef` guard (already correct, unchanged)
means repeated polling refreshes scores without ever resetting the
player's current hole or navigation position.

**Files changed:** `ScoreSessionShell.tsx`.

**Not verified on a real device.** The core mechanism (poll cadence,
merge logic, resume-guard interaction) is traced and internally
consistent, but two-device live synchronization can only be genuinely
proven by two actual devices.

---

## P1 — Side Game Photo Must Be One Moment

**Reproduced the "still broken" report by tracing forward from the
photo-capture step, not just re-reading yesterday's fix.** Yesterday's
fix (checking `side_comp_entries.moment_id` at verification time,
merging into the existing Moment's chat message instead of inserting a
second one) was structurally correct and is still in place — confirmed
all three verification surfaces (`SideCompEntryPanel`'s inline
same-phone confirm, `PendingVerificationCard`, and the underlying
`/verify` route) still converge on that single fix.

**Found the actual remaining bug** in `moments/route.ts` — the step
that links a captured photo's `moment_id` back onto the Side Game
entry it was taken for. That linking check required the **photo
uploader to be the exact same person as the claim's own player** —
`entryRes.data.player_id === user.id`. That's stricter than the
established authority rule this app already uses for acting on
someone else's Side Game claim (`entries/route.ts`'s own submission
endpoint permits any same-group member to submit on another's behalf —
confirmed by reading it directly). An organiser submitting or
capturing on a paper player's behalf, or any same-group proxy
scenario, never satisfied the stricter check — so `moment_id` never
got linked for exactly those cases, meaning yesterday's verification-
time fix correctly found nothing to merge into and correctly (from its
own logic's perspective) fell through to the standalone-announcement
path. This is precisely why the bug persisted for "organiser who is
playing" and "other supported submitting roles," per the brief's own
framing, while presumably having been fixed for the simplest
self-submission case.

**A second copy of the identical bug** was found in the same route:
the `side_comp_lead_changes` update filtered on `player_id = user.id`
(the uploader) when the column actually holds the **claimant's** id —
for a proxy submission those differ, and Supabase doesn't error on a
zero-row update, so this failed completely silently.

**Fix:** both checks now use the same group-membership authority rule
already established in `entries/route.ts` — not a third, independent
rule. Hoisted the authorization result and the claimant's id above
both linking blocks so they can't disagree with each other.

**File changed:** `moments/route.ts`.

**What still needs a real device:** the actual repro (organiser
submits/captures a Longest Drive photo, another player or the same
organiser verifies) needs to be run end-to-end again. I'm confident
this is the correct root cause based on the code trace, but the
original bug's exact submission path (was Darren's claim self-
submitted or proxy-submitted?) wasn't something I could confirm from
this sandbox — worth checking directly if this doesn't resolve it.

---

## P2 — Round Setup Display

**Found:** the Begin Round summary screen (the "Ready to begin" stage,
right before Confirm/Release) showed Group, Tee Time, Players, and
Final Playing Handicaps — but **Starting Hole was completely absent**,
even though the round-level value was already available to this
component. Added a single line to the existing summary banner
(`⛳ Starting Hole {N}`), shown once (it's a round-wide setting, not
per-group, so repeating it under every group would misleadingly imply
it could vary between them). No redesign — the existing flow and
layout are otherwise untouched, per the explicit "current basic flow
is sufficient."

**File changed:** `BeginRoundModal.tsx`.

---

## FILES CHANGED — CONSOLIDATED

- `holes/route.ts` — diagnostic trace (P0)
- `ScoreSessionShell.tsx` — live polling, refresh button, unsaved-input
  preservation (P1)
- `moments/route.ts` — proxy-submission authorization fix, both the
  entry-link and lead-change-link checks (P1)
- `BeginRoundModal.tsx` — Starting Hole added to setup summary (P2)

## MIGRATIONS REQUIRED: No.

Nothing today touches the database schema.

## TESTS

**No new automated tests added this round.** Every fix today is either
route/API authorization logic (moments), a diagnostic trace (holes),
or client-side data-fetching/state-merging logic (ScoreSessionShell,
BeginRoundModal) — none of it is a pure function suited to the
existing `node --test` pure-function suite the way `multiRound.ts`/
`eventMakersBreakers.ts` are. This is a real gap worth flagging rather
than papering over: the moments-route authorization fix in particular
(group-membership-based linking) is exactly the kind of logic that
would benefit from a focused unit test if it were extracted into a
pure function — it currently isn't, and re-testing it required tracing
the code by hand rather than running a test.

**Full existing suite re-run and confirmed unaffected: 310/310 pass**
(251 `src/lib/scoring/**` + 59 `src/lib/highlights/**`), unchanged from
before today.

## REGRESSION / ACCEPTANCE — STATUS AGAINST YOUR 8-POINT LIST

1. Hole-1 round → opens Hole 1 → 1→18 → completes normally — code
   unchanged for this path, should be unaffected; **not re-tested.**
2. Hole-10 round: setup displays Hole 10 (✅ now shown, P2 fix) →
   Scorecard opens Hole 10 → 10→18→1→9 → does not complete after Hole
   18 → completes after all 18 — **traced and found correct in the
   code (P0), not confirmed on a fresh real-device round.**
3. Resume Hole-10 round mid-round — traced and found correct in both
   shells' existing resume logic; **not confirmed on-device.**
4. Two-device scoring: Darren enters, Alex's screen updates
   automatically — **implemented (P1), not confirmed on two real
   devices.**
5. Refresh Scores: updates state, stays on same hole, doesn't lose
   unsaved input — **implemented and the unsaved-input case was
   specifically traced and fixed, not just assumed; not confirmed
   on-device.**
6. Side Game with photo → exactly ONE Moment — **root cause fixed
   (P1), not confirmed on-device.**
7. Side Game without photo → standalone Announcement — unchanged
   fallback path, should be unaffected; **not re-tested.**
8. Regression: playing-partner auto-pair, Previous/Next, multi-player
   layout, Leaderboard/Side Games/My HQ/My Golf — nothing today
   touched any of this code; **not re-tested, but no code path here
   was modified.**

## KNOWN LIMITATIONS / HONEST GAPS

- Every item above needs a genuine real-device pass — this sandbox
  cannot provide that for any of them.
- P0's diagnostic trace is a wait-and-see tool, not a fix in itself —
  if the next test still fails, the trace should make the actual cause
  immediately clear rather than requiring another investigation cycle.
- No automated tests were added for any of today's fixes — flagged
  above as a real gap, not silently skipped.
- The moments-route fix assumes `side_comp_lead_changes.player_id`
  represents the claimant (matching `side_comp_entries.player_id`) —
  confirmed by context and naming, not by directly inspecting live
  data.
