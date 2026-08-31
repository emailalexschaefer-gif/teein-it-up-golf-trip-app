# HOMEPAGE "MY GOLF" ACHIEVEMENT SUMMARY
## Delivery Report — 31 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run, and **there is
no live Postgres connection to actually execute migration 068
against**. The SQL has been syntax/structure-sanity-checked (balanced
parens, balanced `$$` dollar-quoting, column names cross-checked
against the actual table-creation migrations) and its query patterns
match this project's own established RPC conventions exactly — but it
has not been run. This is a real limitation, not glossed over: **please
run this migration against a real/staging database and sanity-check
its four numbers against a real player's known history before this
ships.**

All 6 TypeScript/TSX files touched syntax-check with **zero errors**.
Full test suite: **324/324 pass** (251 scoring + 59 highlights + 8
analytics + 6 new).

---

## Architecture — inspected first, per this project's own established practice

Traced where "My Golf" and achievement-adjacent data actually already
live before writing anything:

- `published_round_highlights` (migration 066) — the organiser-curated,
  genuinely "official" highlight set per round. The one real badge
  signal that exists today.
- `side_comp_lead_changes` — an append-only log where the latest row
  per competition is, by design, the genuine final leader (confirmed by
  reading that table's own migration comment: "written exactly once
  per genuine leadership change").
- `scorecards`/`score_entries` — the only reliable signal for "did this
  player actually play," since a scorecard only exists once
  `begin_round()` has genuinely run.
- `trip_members.UNIQUE(trip_id, profile_id)` — duplicate memberships
  are already structurally impossible at the schema level; no extra
  de-duplication logic was needed for that specific requirement.

**No new badge model, no new win-determination system, nothing
invented to populate this UI** — every number traces to data that was
already the authoritative source for something else in this app.

## The three primary metrics — exact definitions

**Events Played** — `COUNT(DISTINCT trip_id)` across every scorecard
this player has ever had. Excludes drafts and "joined but never
played" trips by construction, since no scorecard exists until a round
actually begins.

**Badges** — `COUNT` of highlight entries across every
`published_round_highlights` row for this player's trips where they're
the subject. Not fabricated, not a placeholder — genuinely zero for a
player whose events never had highlights published.

**Event Wins** — `COUNT` of completed trips where this player holds the
(possibly tied) highest total Stableford points among that trip's
participants.

**Documented simplification, not silently passed off as
authoritative:** this is a points-sum comparison, not the full
hole-by-hole countback ladder (`computeCumulativeStandings` in
`multiRound.ts`) used for the official Final Results page elsewhere in
this app. A genuine points tie here counts as a win for every tied
player. This is a deliberate trade-off — recomputing full countback for
every trip a player has ever participated in, every time they open the
homepage, would be expensive and is unnecessary precision for a
dopamine-layer summary. It is never used anywhere a
precise/disputed-result-grade answer is required. Flagged directly in
the migration's own SQL comments, not just here.

## Expanded view — the fourth (secondary) metric

**Side Game Wins** — reuses `side_comp_lead_changes` exactly as
designed: count of competitions where this player holds the latest
(highest `sequence_number`) entry, restricted to completed trips only
so an in-progress claim never counts prematurely.

**Latest Badge** — title of the most recently published highlight
naming this player, across all their trips. `null`, and hidden
entirely in the UI, when none exists — never a fabricated placeholder.

## Empty / new-player state

Handled explicitly: when all three primary metrics are genuinely zero,
"Your golf story starts here." appears above the stat row rather than
a bare `0 | 0 | 0`. The real numbers still render underneath — nothing
hidden, just framed.

## Future gamification — architected for, not built

Per the explicit "do not implement, but don't force a redesign later"
instruction: `MyGolfSummaryCard.tsx`'s structure deliberately separates
the stat row (permanent) from where a future tier/points header would
slot in — documented directly in the component's own top-level comment
with the exact insertion point, so a future engineer (or session)
doesn't have to re-derive this decision from scratch or restructure
what's already shipped.

## The one genuine architectural gap found and handled

There is no global, cross-trip "My Golf" page in this app — it's a
per-trip experience (`/trips/[tripId]/tournament`). Building one was
out of scope ("No duplicated My Golf implementation" is an explicit
acceptance criterion). Instead: extracted `selectMostRecentTrip()` (a
small, pure, tested function) that picks the single most sensible
existing destination — an active (live/ready/open) trip takes priority
over a completed one, so a player mid-event lands on their actual
current round rather than stale history. This is a real, disclosed
scope decision, not a silent workaround.

## Performance — the actual "avoid N+1" requirement

One RPC call (`get_my_golf_summary`) computes all four numbers
server-side in a single round-trip. The one additional query (finding
the most-recent-trip link target) runs in parallel with the RPC via
`Promise.all`, not sequentially. **Two total queries per Home page
load for this feature, not four-plus.**

## UX details confirmed against the brief

- The three stat blocks are the tap target (`<button>` wrapping the
  number **and** its label), not just the small "View achievements"
  text underneath — per your explicit "large touch targets matter on a
  golf course" instruction.
- Tapping any stat block or the "View achievements ↓" link toggles the
  same expand/collapse state; tapping again collapses — no navigation.
- "View My Golf →" only renders when a link target actually exists
  (a player truly not yet in any trip sees the achievements breakdown
  without a dead link).

---

## FILES CHANGED

- `supabase/migrations/068_my_golf_summary.sql` (new) — the aggregate
  RPC, **not yet executed against any real database**
- `src/app/api/me/golf-summary/route.ts` (new) — API route
- `src/lib/trips/selectMostRecentTrip.ts` (new) — pure function
- `src/lib/trips/selectMostRecentTrip.test.ts` (new) — 6 tests
- `src/components/trips/MyGolfSummaryCard.tsx` (new) — the card itself
- `src/lib/analytics/trackEvent.ts` — added
  `my_golf_summary_expanded`/`my_golf_summary_collapsed` to the event
  union; reused the existing `my_golf_opened` event for the "View My
  Golf →" link rather than creating a duplicate
- `src/app/(app)/dashboard/page.tsx` — card inserted at the exact
  requested position (below Join a Trip, above the My Events heading)

## MIGRATIONS REQUIRED: Yes — `068_my_golf_summary.sql`.

**Not yet run against a live database — see the caveat at the top.**

## TESTS

6 new tests (`selectMostRecentTrip.test.ts`), covering the active-vs-
completed priority logic and the empty-list case, all passing. The RPC
itself is SQL, not something this project's `node --test` pure-function
suite can exercise — its correctness rests on the schema cross-checks
described above and needs a real-database test pass. **Full suite:
324/324 pass** (251 + 59 + 8 + 6), confirmed unaffected.

One thing worth reporting honestly: a batch test run initially showed 1
failure. Traced it immediately rather than assuming it was fine —
turned out to be an artifact of my own ad-hoc test-relocation script
breaking an unrelated, pre-existing test's internal file-scanning logic
(it reads the actual project's migration files by relative path,
which broke when I copied it to a flat `/tmp` directory for batch
running). Re-ran it in its real location to confirm 2/2 pass there,
confirmed no regression, and cleaned up every temporary `.js` file from
the source tree afterward — verified via `find` that nothing was left
behind.

---

## REGRESSION — CONFIRMED BY INSPECTION

- **Create Trip / Join Trip** — zero changes to `DashboardHero.tsx` or
  `JoinByCode.tsx`; the new card was inserted between them and the `My
  Events` heading, nothing about their own code touched.
- **My Events** — `TripList.tsx` completely untouched.
- **Navigation / GA4** — only additive changes to `trackEvent.ts`'s
  type union; no existing event name, call site, or behavior modified.
- **Player/organiser roles** — this card reads only the logged-in
  user's own data (`p_player_id` is always the authenticated user,
  never client-supplied); no role-specific branching needed or added.

## WHAT STILL NEEDS VERIFICATION — PLEASE DO NOT SKIP

1. **Run migration 068 against a real/staging database.** This is the
   single most important outstanding step — the SQL has never
   executed.
2. **Sanity-check the four numbers against a real player with known
   history** — ideally someone who has genuinely won an event, earned
   a published highlight, and won a side game, to confirm each number
   matches expectation.
3. **Mobile layout** — visual review on a real device; nothing here was
   visually tested beyond code-level styling review.
4. Confirm the "View My Golf →" destination (most recent active trip)
   feels right in practice — this was a deliberate, disclosed scope
   decision given no global My Golf page exists, not a certainty about
   what the ideal UX is.
