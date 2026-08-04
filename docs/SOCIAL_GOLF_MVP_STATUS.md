# Social Golf MVP — Status Report

Prepared as the consolidated source of truth for this feature, per the
explicit request. This reflects what was actually built and verified
across the two delivery passes, not a restatement of the original
brief's scope.

---

## Completed

**Package A — Foundation**
- ✓ `social_golf` added as a valid event type (additive migration,
  every existing type preserved — `golf_trip`, `corporate_day`,
  `charity_day`, `golf_society`, `bucks_weekend`, `other` all unchanged)
- ✓ Playing Nine selector (Front / Back / Custom) for 9-hole rounds,
  with real course hole numbers (10-18 for Back Nine, not renumbered)
- ✓ 9-hole Stroke Index fix — SI dropdown and round-start validation no
  longer assume "9 holes = SI 1-9"
- ✓ Multiple rounds under one event — already existed in the schema and
  round-creation flow before this work; confirmed rather than rebuilt
- ✓ Three genuine positional-hole-number bugs found and fixed while
  building Playing Nine (front/back-nine tile splitting in both scoring
  shells, an array-index miscalculation in the group-scorer mode's
  back-nine tile grid, an inconsistent "OUT" subtotal display)

**Package B — Round Lifecycle**
- ✓ `rounds.status` already supported `upcoming` / `active` /
  `completed` — confirmed, not changed
- ✓ An existing close-round route already implemented the
  `active → completed` transition with server-side validation —
  confirmed it existed before building anything new
- ✓ **Strengthened, not rebuilt**: the existing validation checked that
  self/marker entries *existed* but never checked they *agreed* (a real
  mismatch could previously be closed over), and never checked each
  player's own final-confirmation lock. Both fixed.
- ✓ Unlocking a scorecard on an already-completed round now reverts the
  round to `active`, so it can no longer be falsely shown as fully
  complete after a correction is opened

**Package C — Results**
- ✓ `getRoundResult()` — one shared, authoritative helper for a round's
  winner and points, reusing the exact `capture_role='self'` pattern
  already established in the leaderboard route
- ✓ Rounds tab completed-round cards now show winner/joint-winners,
  points, and a compact rest-of-field summary, fetched via a small
  dedicated endpoint that calls the same shared helper
- ✓ "View Results" — confirmed already correctly implemented and
  already pointing at the existing Round Summary route (not rebuilt)

**Package D — Season Summary**
- ✓ `aggregateSeasonSummary()` — pure, database-free aggregation
  function (standings, averages, best round, latest result), built this
  way specifically so it could be unit-tested directly
- ✓ `GET /api/trips/[tripId]/season-summary` — one batched query across
  all of an event's completed rounds, scoped to that event only
- ✓ My HQ UI section, rendered only for Social Golf events with at
  least one completed round
- ✓ Regression tests directly against the brief's own example data
  (Round 1: Alex 20/Dave 18, Round 2: Alex 17/Dave 21, Round 3: Alex 22/
  Dave 22 tied, Round 4 excluded) — confirmed via automated test that
  the output is exactly 3 completed rounds, 2 wins each, averages 19.67
  and 20.33, best round 22 joint, latest result Round 3 tied

**My Round — audited (not originally planned as a completed item, but
turned out already correct)**
- ✓ Confirmed `PlayerRoundView.tsx` already correctly distinguishes an
  active round ("Continue Scoring") from a completed one ("View Live
  Leaderboard" / "View Final Results") — traced directly in the
  underlying API route's status computation, not assumed
- ✓ Confirmed it already shows position, birdies, and best hole for a
  completed round

---

## Still Outstanding

- **Awaiting Scores / Ready to Finalise card states** — the Rounds tab
  currently only distinguishes upcoming/live/completed. The finer-
  grained readiness states the original brief describes ("Waiting on 1
  scorecard," "2 mismatches require review," "Ready to finalise") would
  need live readiness data fetched per active round, which wasn't built.
- **"Finalise Round" UI polish** — the server-side validation gate is
  real and tested; the button is still labelled from the earlier
  "close round" work, and the specific confirmation-modal copy the
  brief describes wasn't added.
- **My Round enhancements** — confirmed correct on the core lifecycle
  behavior and confirmed several content items already present, but no
  field-by-field audit was done against the brief's complete list
  (front/back-nine totals, exact handicap display, group/marker names,
  Moments integration).
- **Advanced statistics** — explicitly out of scope per the original
  brief's own non-goals list (streaks, achievements, head-to-head
  records, etc.) and not attempted.

---

## Files Changed

**Created**
- `src/lib/scoring/roundResult.ts` — shared result/aggregation helpers
- `src/lib/scoring/roundResult.test.ts` — Season Summary regression tests
- `src/lib/scoring/defaultHoles.test.ts` — Playing Nine regression tests
- `src/app/api/trips/[tripId]/season-summary/route.ts`
- `src/app/api/trips/[tripId]/rounds/[roundId]/result/route.ts`
- `supabase/migrations/033_social_golf_event_type.sql`
  (+ `social_golf_event_type_deploy.sql`)

**Modified**
- `src/types/app.ts` — event type options
- `src/app/(app)/trips/[tripId]/TripDetailClient.tsx` — invite wording
- `src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts` —
  strengthened finalisation validation
- `src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts` —
  unlock reverts round status
- `src/components/scoring/TournamentControl.tsx` — Season Summary
  section
- `src/app/(app)/trips/[tripId]/tournament/page.tsx` — passes
  `eventType` through
- `src/app/(app)/trips/[tripId]/tabs/TripRoundsTab.tsx` — result cards
- `src/components/scoring/BeginRoundModal.tsx` — Playing Nine, SI fix
- `src/lib/scoring/defaultHoles.ts` — Back Nine template
- `src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts` — SI/hole
  number uniqueness validation
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`
  and `ScoreSessionShell.tsx` — front/back-nine positional-index fixes

---

## Database Changes

- `033_social_golf_event_type.sql` — additive, widens `event_type`
  CHECK constraint. No data migration needed; every existing row already
  satisfies the widened constraint.
- No other schema changes — `rounds.status`, `holes.hole_number`
  (1-18), and `holes.stroke_index` (1-18) constraints were all already
  correct and independent of hole count; confirmed by inspection rather
  than assumed.

---

## Test Results

**102/102 scoring-domain tests pass** (82 baseline at the start of this
work, +6 Playing Nine/Stroke Index regression tests, +8 Season Summary
regression tests, +6 further Playing Nine template tests). Re-run after
every change described above; none of this work touched Stableford,
marker comparison, or reconciliation logic, confirmed by the unchanged
baseline tests continuing to pass throughout.

No database-dependent tests were added or run — this sandbox has no
live Supabase connection. Everything database-dependent (the migration
itself, event creation, multi-round membership persistence, the
strengthened close-route validation, the unlock-reverts-status fix, and
the Season Summary/result endpoints against real data) still needs
field testing.

---

## Recommended Deployment Order

1. **Database** — run `033_social_golf_event_type.sql` (or the
   standalone deploy script). Verify with a `SELECT` against
   `information_schema` or by attempting to create a trip with
   `event_type = 'social_golf'` in the SQL editor before touching the
   app.
2. **Backend** — deploy the API routes and strengthened validation
   (`close`, `scorecards` unlock, `season-summary`, `result`). These are
   safe to deploy ahead of the frontend — they don't change any existing
   route's behavior for non-Social-Golf events, and the new endpoints
   are inert until called.
3. **Frontend** — deploy the UI changes (event type selector, Playing
   Nine, Rounds tab cards, My HQ Season Summary). Test against a real
   Social Golf event created in step 1 before relying on it for the
   Friday field test.

---

## Future Roadmap (Not Yet Started)

Nothing under this heading is committed. It is parked here specifically
so these ideas don't leak into October work — see `ROADMAP.md` for
where they'd eventually sit against a timeline.

**My Golf** — My Trips · My Social · My Events

**Social Golf**
- Season ladder
- Rivalries
- Streaks
- Head-to-head
- Personal records

**Golf Trips**
- Accommodation
- Itinerary
- Travel timeline
- Trip memories

**Special Events**
- Sponsors
- Charity
- Corporate branding
- Registration

**Moments**
- Story timeline
- AI highlights
- Albums
- Video

---

## What This Report Does Not Cover

This is a status report for the Social Golf MVP work specifically. It
doesn't restate the many scoring-screen layout and UX fixes from
earlier in this project's history, which have their own record in
`TESTING.md`. It also isn't the place for product direction — see
`VISION.md` for that, and `ROADMAP.md` for how future work (including
the Future Roadmap section above) is sequenced against a timeline.
Treat all four documents together as the current source of truth: this
one for "what state is Social Golf in," `TESTING.md` for the full
chronological record of every fix and why, `VISION.md` for why the
product exists, and `ROADMAP.md` for what's next and when.
