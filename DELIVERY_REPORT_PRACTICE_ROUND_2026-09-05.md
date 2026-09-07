# SEPARATE SOLO EVENT PLAY FROM PRACTICE ROUND MODE
## Delivery Report — 5 Sep 2026

**Build/test caveat, unchanged from every prior round:** no network
access — `npm run build` was not run, and there is no live database
connection to execute either new migration. All 10 touched files
syntax-check with **zero errors**, verified fresh this session. Full
test suite: **409/409 pass** — every business-logic suite unaffected,
confirming nothing in Practice mode touched the scoring engine itself.

**Caught and fixed one real mistake mid-implementation, worth
surfacing directly:** a `str_replace` edit to `LiveLeaderboard.tsx`
initially left the file with mismatched braces (the original error
state's closing tags ended up stranded after my new practice-check
block instead of before it). Caught by re-viewing the file immediately
after the edit rather than assuming it landed correctly, then
corrected and re-verified with a fresh syntax check before moving on.

---

## 1. WHAT SOLO-PLAYER CODE HAD ALREADY BEEN IMPLEMENTED

Per the prior investigation (5 Sep, same day): a solo Digital player
inside a real Event group already worked correctly -- no partner UI, no
false blocker, completion based purely on the player's own holes. A
solo Paper player already worked via the existing organiser
Score Management override path. Side Game verification for a solo
claimant already had a `self_verified_fallback` tier. None of this was
built for the current brief -- it predates it.

## 2. WHAT WAS PRESERVED

All of the above, untouched. No file from that investigation was
modified. The one file this brief *did* touch that's adjacent to solo
support -- `src/app/api/trips/route.ts` -- had its `players_per_group`
minimum relaxed from 2 to 1 (see item 3), which if anything makes
creating a genuine one-player Event group *easier* through the normal
wizard than it was before, not harder.

## 3. WHETHER ANY SOLO LOGIC NEEDED NARROWING

**No solo-Event logic needed narrowing.** Nothing found in the prior
investigation or this one generalised "one player = self-verified
competition" -- the self-verified fallback in Side Game verification
only ever activates when genuinely nobody else exists to verify, which
is exactly as true inside a real Event's one-player group as it will
be inside Practice; that mechanism doesn't need or get a Practice-aware
carve-out, because its behaviour is already correct for a solo group
either way.

**One genuine, unrelated blocker was found and fixed instead**: the
trip-creation schema hardcoded `players_per_group.min(2)`, which would
have rejected an attempt to explicitly request a one-player group
through the normal creation wizard. Traced its only actual use (a
single INSERT, never read back to enforce a real limit) before
concluding the floor could safely drop to 1 without weakening anything.

## 4. HOW PRACTICE IS EXPLICITLY CLASSIFIED

`trips.is_practice BOOLEAN NOT NULL DEFAULT false` (migration 074).
Never inferred from group size, player count, or scoring method --
set explicitly to `true` only by the new `/api/practice/create` route,
and `false` for literally every other trip in the system, including
every existing trip once this column appears.

## 5. WHETHER SCHEMA CHANGES WERE REQUIRED

**Yes, one column, confirmed genuinely necessary first.** Read every
migration touching `trips` before adding anything: `event_type`
already exists but is a descriptive event-category label (golf_trip/
corporate_day/etc.), used for display elsewhere -- reusing it would
conflate "what kind of event" with "is this even a real event," two
different concepts. No round-level competition-mode flag existed
anywhere. `is_practice` is the narrow, explicit field the brief asked
for, added once, nothing else.

## 6. EXACT FILES CHANGED

**Migrations (new):**
- `supabase/migrations/074_trips_is_practice.sql`
- `supabase/migrations/075_my_golf_summary_excludes_practice.sql`

**Application (new):**
- `src/app/api/practice/create/route.ts`
- `src/app/(app)/practice/new/page.tsx`

**Application (modified):**
- `src/app/api/trips/route.ts` -- `players_per_group` bound, `is_practice` passthrough
- `src/app/api/trips/[tripId]/rounds/[roundId]/leaderboard/route.ts` -- practice gate
- `src/app/api/trips/[tripId]/final-results/route.ts` -- practice gate
- `src/app/api/trips/[tripId]/rounds/[roundId]/highlights/route.ts` -- practice gate
- `src/app/api/trips/[tripId]/rounds/[roundId]/published-highlights/route.ts` -- practice gate
- `src/app/api/me/event-stories/route.ts` -- practice exclusion
- `src/components/trips/DashboardHero.tsx` -- Practice Round entry link
- `src/components/scoring/LiveLeaderboard.tsx` -- graceful practice response handling

## 7. ENTRY POINT USED FOR PRACTICE

**Investigated the "Create Golf" menu concept first, as explicitly
instructed.** Found no "Social Golf" concept anywhere in this codebase
and exactly one existing creation entry point ("+ Create Trip" on the
Dashboard, straight into the multi-step trip wizard). Building the
brief's own preferred three-option "Create Golf" menu would mean
inventing "Social Golf" from nothing and restructuring the primary
navigation CTA -- judged too invasive for this release, per the
brief's own explicit permission to report a safer minimal option
instead.

**Implemented minimal option:** a small, secondary "Practice Round"
link directly beneath the existing "+ Create Trip" button -- its own
explicit, separate path, without touching or restructuring the
existing primary CTA. Leads to a single-screen form
(`/practice/new`), never the Event wizard.

**Recommendation for later:** if Practice adoption is meaningful, a
genuine "Create Golf" landing menu (Social Golf / Practice / Event) is
worth building deliberately, once "Social Golf" itself has some actual
architecture to point at -- not retrofitted into this pass.

## 8. HOW SCORING IS REUSED

Entirely. `/api/practice/create` calls the exact same `begin_round()`
RPC the normal Finalize Round flow already uses, with this one
player's data. From that point forward, the created round is a normal
`rounds`/`scorecards`/`score_entries` row set -- the player is routed
straight into the existing round page and the existing scoring shell,
completely unmodified. Stableford calculation, handicap application,
hole navigation, offline queue, and Sync Now are the identical code
paths used for a normal Event round -- none of them are aware Practice
mode exists, because the scoring engine itself needed no changes at
all.

**Named scope limitation:** Course Library is not integrated in this
first pass. Hole data uses a standard, uniform par-72 layout rather
than a real course's actual par/stroke-index -- `courseName`/`teeName`
are free-text labels only. This is deliberate, matching the explicit
"keep it minimal" instruction, not an oversight.

## 9. HOW PRACTICE BYPASSES PARTNER VERIFICATION WITHOUT WEAKENING EVENT VERIFICATION

Practice never touches partner/marker logic at all -- the created
scorecard has `scoring_method: 'digital'`, a single-player group, and
no `round_markers` row is ever created for it, exactly matching how a
genuine solo Event group already behaves (per the earlier
investigation). No verification code was modified, weakened, or given
a Practice-specific branch -- the existing "no partner exists, nothing
to verify" behaviour already handles this correctly for any solo
group, Practice or Event.

## 10. HOW PRACTICE IS EXCLUDED FROM EVERY COMPETITIVE SYSTEM

- **Leaderboard**: `leaderboard/route.ts` checks `is_practice` before
  any standings computation runs at all.
- **Event Winner**: `final-results/route.ts` checks before the
  champions/standings computation.
- **Makers & Breakers**: `highlights/route.ts` (generation) and
  `published-highlights/route.ts` (publication) both independently
  refuse -- publication gets its own check as defence in depth, since
  it's the one irreversible step in that pipeline.
- **Side Games**: never set up for a Practice trip in the first place
  (the creation route doesn't create any `side_comps` rows) -- no UI
  path exists to add them either, since Practice never reaches the
  organiser's Side Games setup screen.
- **Ecosystem/competitive points, Event participation, organiser
  activation, Event Pass/Credit**: `get_my_golf_summary()` (migration
  075) -- found and fixed a real gap here: `events_played`,
  `event_wins`, and `side_game_wins` had no practice-awareness at all
  before this fix. A solo Practice round, being the only participant,
  always has the single highest score in its own trip and would have
  silently counted as an "Event Win" on the Home summary card. Fixed
  by adding `is_practice = false` to the three relevant joins,
  verified via a precise diff against the real current function body
  showing only the intended lines changed. `badges` was already safe
  by construction -- a Practice trip can never acquire a
  `published_round_highlights` row at all, given the Makers & Breakers
  gates above.

## 11. HOW PRACTICE APPEARS IN MY GOLF

**Partially implemented -- a named gap, not silently skipped.**
Practice trips are correctly *excluded* from My Event Stories (the
competitive history archive) via the fix in item 10. A distinct,
styled "Practice" display *within* My Golf (the brief's own "PRACTICE
/ Sandhurst North / 34 pts / 7 Sep 2026" example) was not built in
this pass -- Practice rounds are retained in the database (never
discarded) but have no dedicated My Golf presentation yet. This is the
clearest remaining gap if this work continues.

## 12. CONFIRMATION ONE-PLAYER NORMAL EVENT GROUPS STILL WORK

Nothing in the prior investigation's findings was touched. The one
change that overlaps at all -- `players_per_group`'s relaxed floor --
makes creating a one-player Event group *more* permissive through the
wizard, not less, and doesn't touch any of the actual scoring,
completion, or verification logic that investigation confirmed already
worked correctly.

## 13. TESTS ADDED/UPDATED

**None.** Every change in this package is either a database migration
(verified via precise diff, not a pure function to unit test), a
gating check in an existing route (guarding against a condition, not
new calculation logic), or new UI/orchestration code with no
extractable pure-function logic. The unchanged 409/409 result across
every existing suite is the regression evidence that nothing in the
scoring/competitive-calculation engine itself was altered.

## 14. FULL AUTOMATED TEST RESULT

**409/409 pass** -- 274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 5 SQL-scanning migration tests + 54 trips.
Every suite re-run fresh this session.

## 15. REAL-DEVICE ACCEPTANCE STILL REQUIRED

Everything in this package is unverified beyond code inspection and
syntax/test checks. Specifically:

1. **Both migrations have never run.** Apply 074, then 075.
2. Create a genuine Practice Round end to end: tap the new Dashboard
   link, submit the form, confirm it lands directly in scoring with no
   Playing Partner UI of any kind, score a full round, confirm
   completion.
3. Confirm the round's own "Live Leaderboard" overlay shows the new
   practice message cleanly rather than any broken/empty state -- this
   is the one place a real crash was found and fixed in this session,
   and deserves direct confirmation on a device, not just a code
   review.
4. Confirm the practice trip does **not** appear anywhere in My Event
   Stories, does not affect the Home card's Events/Wins counters, and
   has no Side Games setup option anywhere in its own organiser view.
5. **Separately**, re-confirm the two solo-Event scenarios from the
   earlier investigation (solo Digital, solo Paper) still behave
   exactly as before -- the `players_per_group` change is low-risk but
   has never been exercised on a real device either.
6. My Golf's Practice display (item 11) needs to be built and then
   verified -- not yet ready for a device check at all.
