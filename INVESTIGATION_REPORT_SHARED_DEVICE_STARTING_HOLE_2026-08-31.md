# P0 — DIGITAL + PAPER SHARED-DEVICE SCORING, INCLUDING BACK-NINE STARTS
## Investigation Report — 31 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run, and **this
sandbox has no way to run the four isolation scenarios or the hard
acceptance test on a real device.** Everything below is a code-level
trace. Both files touched syntax-check with **zero errors**. Full test
suite: **318/318 pass** (251 scoring + 59 highlights + 8 analytics),
confirmed unaffected. The trips directory (54 tests) wasn't touched
this round and was already confirmed passing in the immediately prior
round.

---

## Honest headline, before the detail

**I could not conclusively confirm or rule out that back-nine starts
are the specific regression boundary — that requires the four
isolation scenarios run on a real device, which I cannot do from here.**
What I *can* report: I traced every item on your own inspection
checklist, in every file it named, and found **no hole-number-dependent
bug anywhere in the shared-device detection, resolution, or hydration
chain** — every lookup in that chain is keyed by `hole_number`, never
by array index, and the one place array order genuinely matters
(`holes/route.ts`'s play-sequence reordering) applies unconditionally,
with no shared-device-specific branch that could diverge from it.

I did find and fix two real, concrete bugs while tracing this — neither
is confirmed to be *the* reported bug, and neither is specifically
back-nine-related, but both are genuine gaps closed along the way.

---

## Trace — followed the paper player through every stage you listed

- **paper designation → `scoring_method`** — traced to migration 069
  (this session's own earlier fix): `begin_round()` now explicitly
  writes `scoring_method` from `p_scorecard_data`, and `start/route.ts`
  explicitly re-reads and carries it through. Confirmed no hole-number
  dependency anywhere in this path — it operates purely on player/group
  identity.
- **`begin_round` → scorecard/round-player state** — confirmed
  scorecard creation itself has no hole-number branching; the same
  loop creates every player's scorecard identically regardless of the
  round's `starting_hole_number`.
- **group association** — `resolveSharedDeviceGroupForPlayer` and
  `page.tsx`'s own inline detection both use live `trip_members.group_id`,
  confirmed hole-agnostic (re-verified this session, having already
  audited both in the prior multi-group investigation).
- **starting-hole resolution** — `holes/route.ts` reorders the holes
  array via `orderHolesByPlaySequence` based on the round's
  `starting_hole_number`, unconditionally — this function has no
  awareness of scoring_method or shared-device status at all, so it
  cannot behave differently for a shared-device pair vs. two ordinary
  digital players.
- **shared-device resolver → API response → live scoring render** —
  `SelfMarkerScoreShell.tsx`'s hydration (`partnerSelf`, `partnerMarker`,
  `mySelf`, `myMarker`) is keyed by `hole_number` throughout, confirmed
  by reading every access point. The one place a hole INDEX is used at
  all (`holeIdxSeededRef`, seeding the initially-displayed hole) only
  ever affects *which hole is shown first*, never *whether the partner
  card renders at all* — those are structurally independent pieces of
  state in this component.

**I found the first (and only) place the paper player's card could
disappear entirely**, and it isn't hole-number-related:

### Bug 1 — Card 2's render gate excluded a supported capture mode

`page.tsx` computes shared-device detection (`isSharedDeviceForMe`) for
any round where `score_capture_mode !== 'group_scorer'` — explicitly
including `'individual'` mode, confirmed by reading the exact condition.
But `SelfMarkerScoreShell.tsx`'s Card 2 (the partner's scoring card)
was gated behind `requiresMarker`, which is only true for
`score_capture_mode === 'self_and_marker'`. A shared-device pair
configured under `'individual'` mode would have every piece of data
fully resolved and passed in by `page.tsx`, then silently never
rendered — the exact symptom described ("only the digital player's
scorecard appears").

**Is this the reported bug?** Genuinely uncertain. `score_capture_mode`
defaults to `'self_and_marker'` (migration 022) and nothing in the
round-creation wizard appears to override it, so most rounds — likely
including whatever round was actually tested — probably use the
default, which this bug wouldn't affect. I'm not claiming this is *the*
fix; I'm reporting a real, independently-verified inconsistency found
while tracing the exact chain you asked me to trace, fixed regardless
of whether it explains the specific field-test failure.

**Fixed:** broadened the card's render condition to
`(requiresMarker || isSharedDeviceScoring)`. Kept the separate "Change
who I'm marking" button gated to `requiresMarker` only, and explicitly
did *not* just broaden that too — that button calls the
`round_markers`-based `/playing-partner` endpoint, which has no
meaning for a shared-device pair (that relationship is derived
automatically from group membership + `scoring_method`, never a manual
choice) — broadening it would have offered an action with nothing
behind it.

### Bug 2 — Shotgun starting-hole picker: hardcoded highlight (found, not the reported bug, fixed anyway)

While specifically checking your "hole_number === 1" / "index 0
assumed to represent Hole 1" checklist items, found this exact pattern
in the shotgun fallback picker (the screen shown when a shotgun round
hasn't assigned a group's starting hole yet): the button grid always
visually highlighted hole 1 as if selected, regardless of what the
player had actually tapped — `pendingStartHolePick` (the real selection
state) was never referenced in the styling at all. Purely cosmetic,
unrelated to card visibility or scoring, but a genuine instance of
exactly the assumption pattern you asked me to search for. Fixed to
reflect the actual selection.

---

## What I checked and explicitly ruled out

- `hole_number === 1` used as a "has this player started" signal
  anywhere in the leaderboard/tournament API routes — **not found**;
  every "has started" check I located uses `holesPlayed > 0` (a count,
  correctly order-agnostic), not a specific hole's presence.
- `currentHole === 1` / index-0-as-hole-1 assumptions in the
  shared-device resolver or hydration path — **not found**, confirmed
  hole_number-keyed throughout.
- Shared-device detection scoped incorrectly for multi-group rounds —
  **not found**, re-confirmed from the prior session's audit, still
  correct.

---

## Files changed

- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`
  — Card 2 render gate broadened (Bug 1); shotgun picker highlight
  fixed (Bug 2)

## Migrations / RPC / RLS changes: none this round

No security-boundary changes were needed — both fixes are
presentation-layer (what renders, and what a picker highlights), not
authorization changes. The digital-player-scores-paper-player authority
model itself (traced again this session) is unchanged and was not
found to have any gap.

## Test results

- Focused: none new (both fixes are UI-rendering conditions, not pure
  functions with an obvious unit-testable extraction).
- Full suite: **318/318 pass**, confirmed unaffected.
- **The actual required tests — the four isolation scenarios and the
  14-step hard acceptance test — were not run.** This sandbox cannot
  run a live app against a live database. This is the single most
  important gap in this report.

---

## What you actually need to do next

Per your own brief's structure, here's the retest plan, using what
this trace narrowed down:

1. **Run the four isolation scenarios on a real device first**, exactly
   as your brief specifies, *before* assuming either of my two fixes
   addresses the real issue. If Digital+Paper fails identically on
   both Hole 1 and Hole 10, that would point toward Bug 1 (the capture-
   mode gate) as the actual cause — check what `score_capture_mode` the
   failing round actually used. If it only fails on Hole 10, neither
   of my fixes explains it, and the actual back-nine-specific cause is
   still unfound — tell me that result specifically and I'll resume
   the trace from there with a live data point to work from, rather
   than guessing further from static analysis alone.
2. Run the 14-step hard acceptance test with a Hole 10 start.
3. Repeat with a Hole 1 start to confirm nothing regressed.
4. Test one shotgun round if it shares this engine (confirmed
   architecturally that it does — `holes/route.ts` and the hydration
   path are the same code for shotgun and standard rounds alike, only
   the starting-hole *resolution* differs).

I'd rather hand you an honest "here's what I ruled out and here's what
I genuinely can't confirm without a device" than claim a fix for a bug
I couldn't reproduce or prove.
