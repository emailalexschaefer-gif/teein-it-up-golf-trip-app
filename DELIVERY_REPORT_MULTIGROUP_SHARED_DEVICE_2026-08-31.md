# CONSOLIDATED FIELD-TEST FIX — MULTI-GROUP + SHARED-DEVICE SCORING
## Delivery Report — 31 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run, and **there is
still no live Postgres connection** to execute the new migration
against. All 3 TypeScript/TSX files touched syntax-check with **zero
errors**. The new migration's SQL body was verified by direct diff
against the real, current `begin_round()` definition (see below) —
**it has never executed against a live database.** Full existing test
suite: **372/372 pass**, confirmed unaffected.

---

## P0 / P0B — traced as one systemic fix, per your explicit instruction

I did not patch the screenshots individually. I traced the full
participant/session/authority chain, checking every item on your own
inspection list one at a time, and confirmed each was **individually
correct**:

- `detectSharedDeviceGroup` (the pure detection function) — correct.
- `resolveSharedDeviceGroupForPlayer` — correctly uses live
  `trip_members.group_id`, not the known-broken per-round snapshot
  column.
- `page.tsx`'s own inline shared-device detection (a second,
  independent implementation used for the initial page render) — also
  correct, same live source, confirmed not to have drifted from the
  helper above.
- The organiser-only `/scoring-method` PATCH route — correctly
  authority-gated to the organiser only, never the paper player
  themselves.
- `BeginRoundModal`'s paper-player toggle UI — correctly iterates every
  playing group, not just one (this ruled out a multi-group-specific
  rendering bug, which I checked specifically since this was your
  first real test with two groups).
- `begin_round()`'s scorecard upsert logic — structurally sound.

**The actual root cause**, found by tracing what happens *before*
`begin_round()` ever runs: `scoring_method='paper'` has exactly one
path into existence in this codebase — an organiser manually toggling
a player in `BeginRoundModal`, which pre-creates a minimal scorecard
row ahead of the round starting. `begin_round()` itself was
deliberately written to never reference `scoring_method` at all,
relying entirely on Postgres's implicit "an omitted column keeps its
existing value on UPDATE" behaviour to preserve that earlier choice —
correct in principle, but nothing anywhere ever *confirmed* what value
actually existed by the time the round started, and `start/route.ts`'s
own scorecard-data construction never read or carried `scoring_method`
at all. If that one prior manual toggle was ever missed, mistimed, or
silently reverted (its own client-side code already reverts the UI on
any network failure), the paper player's scorecard is created with the
column's bare default of `'digital'` — which fully and precisely
explains the observed symptom: TEST still appears everywhere that
reads general trip/scorecard/leaderboard data, but vanishes
specifically from shared-device detection, since that requires exactly
one digital + one paper player and two `'digital'` rows are
indistinguishable from two ordinary digital players who simply haven't
opened their own scoring session yet.

This same root cause explains P0B too, not as a separate bug: it isn't
that the architecture requires the paper player to press anything
(`start/route.ts` already creates scorecards for every assigned player
across every group in one atomic action, regardless of who presses
"Start Scoring") — it's that when the fragile pre-round toggle silently
fails, the *symptom* looks exactly like "the paper player needs to do
something," because their session doesn't work, when the actual issue
is upstream of any session at all.

### Fix — made the whole chain explicit and defensive, not implicit

1. **`supabase/migrations/069_begin_round_carries_scoring_method.sql`**
   (new) — redeclares `begin_round()` to explicitly write
   `scoring_method` on both insert and update, using whatever value
   `p_scorecard_data` supplies, falling back to the column's own
   default only when genuinely absent. **Verified, not reconstructed
   from memory:** I initially drafted this from grep excerpts of
   migration 064 and caught myself before finalizing it — redeclaring
   a `SECURITY DEFINER` function from an incomplete view is exactly
   the mistake 064's own header comment warns about having happened
   once already in this project's history. I stopped, read the
   complete, exact current function body directly, and rewrote the
   migration from that. A direct diff against the real source confirms
   only 4 intentional changes exist (the parameter comment, one new
   local variable, and the scorecard INSERT/ON CONFLICT clause) —
   every invariant check, the exception handler, and the `GRANT`
   statement are byte-identical to 064.
2. **`start/route.ts`** — now explicitly re-reads each assigned
   player's current `scoring_method` from any already-existing
   scorecard row before building `p_scorecard_data`, and passes it
   through explicitly to both the RPC path and its direct-insert
   fallback (which had the identical gap). The value is now carried
   end-to-end regardless of whether the one prior client-side toggle
   succeeded, was skipped, or reverted — a round can no longer silently
   start a designated paper player as digital.

---

## Group-naming bug — found and fixed, same root cause class as an earlier fix

Traced the "Playing Group 1" / "Playing Group 1" duplicate labeling
directly to `TripGroupsTab.tsx`'s `addGroup()`: it computes its default
name client-side from the current local `groups.length` at the moment
of the click. If the "+ Create Playing Group" button fires twice before
the first request's response updates that local state — a double-tap,
or a slow network — both requests compute the identical name, since
neither has seen the other's not-yet-returned result. **This is the
exact same bug class already fixed once before in this project** for
round numbering (`getRoundDisplayName`) — I recognized the pattern
immediately from that prior fix's shape.

Confirmed the actual culprit before fixing: unlike its two sibling
buttons in the same file (`generateGroups`/`autoAssign`), "+ Create
Playing Group" had **no pending-state guard at all** — nothing
prevented a rapid double-tap from firing two concurrent requests.

**Fixed both ends:**
- **Server** (`groups/route.ts`) — the route already computes a
  race-free `sortOrder` via a fresh DB query at request time; this now
  also derives the *default* name from that same authoritative value,
  not the client-supplied one — but only for the exact auto-generated
  `"Playing Group N"` pattern, so a genuinely custom name (an
  organiser's own deliberate choice, via the separate rename PATCH
  route) is never overridden.
- **Client** (`TripGroupsTab.tsx`) — added the same `disabled`-while-
  pending guard its sibling buttons already had, closing the race at
  its actual source, not just papering over the symptom server-side.

## What I found but deliberately did not fix this round

While tracing `StartingGrid.tsx` for the naming bug, found a genuinely
separate, real issue: the "· Hole 1" text next to each group's tee
time is a hardcoded literal string, not derived from the round's actual
Starting Tee configuration (`starting_hole_number`) — it would show
"Hole 1" even for a round correctly configured to start on Hole 10.
**Not fixed this round, and flagged rather than rushed**: this is a
latent bug, not something your screenshots show as currently broken
(nothing in this test's scenario exercises a 10th-tee round), and
fixing it properly would need threading the round's Starting Tee
config into this component, which isn't currently available there
without either a new fetch or a prop change from its parent — real
scope, deserving its own verified pass rather than a rushed addition
onto an already-large delivery.

**The "small Start Round UI improvement" mentioned in your brief's
intro was not identified or addressed this round** — I found the
group-naming bug independently while investigating the P0/P0B
authority model, but didn't locate a separate, distinct "Start Round
UI" item to address. If this refers to something specific, please point
me at it directly next round rather than have me guess.

---

## FILES CHANGED

- `supabase/migrations/069_begin_round_carries_scoring_method.sql`
  (new)
- `src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts`
- `src/app/api/trips/[tripId]/groups/route.ts`
- `src/app/(app)/trips/[tripId]/tabs/TripGroupsTab.tsx`

## MIGRATIONS REQUIRED: Yes — `069_begin_round_carries_scoring_method.sql`

**Not yet run against a live database — see the caveat at the top.**
This migration must run before the `start/route.ts` changes can have
any effect (the route now sends a `scoring_method` field the RPC
doesn't yet know to use until this migration applies).

## TESTS

No new automated tests this round — this is authorization-model/data-
flow logic (a Postgres RPC and two API routes) with no pure-function
piece to extract and unit-test in isolation, the same category as the
GA4 wiring and My Golf endpoints in recent rounds. Full existing suite
re-confirmed unaffected: **372/372 pass** (251 scoring + 59 highlights
+ 8 analytics + 54 trips).

---

## WHAT STILL NEEDS VERIFICATION — PLEASE DO NOT SKIP

1. **Run migration 069 against a real/staging database** — this is the
   single most important outstanding step. Confirm it applies cleanly
   and `begin_round()` still passes its own invariant checks.
2. **Re-run the exact multi-group + shared-device scenario from this
   test**, on a fresh round: Alex (digital) + TEST (paper) in Group 1,
   Darren (digital) + Darren's paper account in Group 2. Confirm both
   digital players see their paper partner on their own scoring screen
   from the moment either one presses "Start Scoring" — neither paper
   player should need to do anything at all.
3. **Confirm the group-naming fix**: rapidly create two groups in
   succession (simulating the double-tap) and confirm they get
   distinct names now, both from the client guard and, independently,
   by testing the server's own de-duplication if the client guard is
   somehow bypassed.
4. Confirm the Live Leaderboard, group setup, and every other surface
   that already worked correctly in this test remain unaffected —
   nothing in this round's changes touches those read paths.
