# MULTI-ROUND INTEGRITY + SIDE GAMES + MAKERS & BREAKERS POLISH
## Delivery Report — 2026-08-28

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox (`npm install` returns 403), so `npm run build`
could not be run. All 10 files touched this round were syntax-checked
directly with the TypeScript compiler — zero errors. All 224 scoring
tests + 46 highlights tests pass unchanged. **Run `npm run build`
before this ships.**

Per the explicit instruction, I inspected the current code before
changing anything. Several pieces of this brief (Side Games'
round-grouping architecture, the canonical chronological sorter) were
already correctly built — I left that architecture alone and fixed the
specific gaps, rather than rewriting anything that already passed
inspection.

---

## 1. Round-order corruption — exact root cause

**Not a sorting bug.** `sortRoundsChronologically()` (play_date, then
created_at, then id as tiebreakers) already existed and is correct —
confirmed by its own 65 passing tests.

**Actual root cause:** a new round's stored `name` (e.g. "Round 3") is
generated client-side in the round-creation wizard
(`StepRounds.tsx`: `` `Round ${rounds.length + 1}` ``) — from the
*current count* of rounds at creation time, not from where the round's
`play_date` will actually land once sorted chronologically. The moment
a round is added whose date falls before an existing round's date
(exactly your test case), its stored name silently disagrees with its
true chronological position. Several screens then displayed that
stored name directly as the round's number.

A second, compounding bug: `tournament/page.tsx` (My HQ / My Golf) and
`TripRoundsTab.tsx` (round setup — the exact screen your screenshot was
taken on) both had their **own** ad-hoc `.sort((a,b) =>
a.play_date.localeCompare(b.play_date))`, with **no tiebreaker at
all**, and hadn't even selected `created_at` from the database. Any two
rounds sharing a play_date (which your added round did, with Round 1)
would sort in arbitrary order.

**Fix:** `getRoundDisplayName(round, sortedRounds)` — a pure function
that overrides a round's displayed label to match its actual
chronological position, but **only** when the name still matches the
plain, auto-generated "Round N" pattern. A genuinely custom name (e.g.
"Final Round") is always left untouched — this never overwrites
deliberate organiser text. Wired into every screen that renders round
names: `TripRoundsTab.tsx`, `tournament/page.tsx` (covers both My HQ
and My Golf, which share this page), and the Side Games route (below).
Also added `created_at` to every relevant query and switched both
ad-hoc sorts to the canonical `sortRoundsChronologically`.

## 2. Stale COMPLETE lifecycle — exact root cause

`close/route.ts` already had a one-way `live → completed` transition,
derived from round state (all rounds completed → trip completed) — but
nothing existed for the reverse. Adding a new round after the trip was
marked `completed` left the trip's `status` column stuck, because
nothing ever re-evaluated it.

**Fix:** in the trip PATCH route (`src/app/api/trips/[tripId]/route.ts`),
after rounds are reconciled, re-fetch the trip's current rounds and
status. If the trip is currently `completed` but not every round is —
which can only be true immediately after a new round was just added —
it reverts to `live` (the same status `start/route.ts` already uses for
"an event with rounds in progress"). This is symmetric with `close/
route.ts`'s existing transition, derived fresh from round data every
time, not a flag. Historical completed rounds are never modified.

## 3. Leaderboard "only using Round 1 as Previous" — investigated, likely not a separate bug

Traced `leaderboard/route.ts` in full: it already uses
`sortRoundsChronologically`, then takes **every** round up to and
including the currently-viewed one (`sortedRounds.slice(0,
currentRoundIdx + 1)`) — not "the previous round" as a singular
concept. `derivePreviousCurrentTotal` computes `previous = totalPoints
- currentRoundPoints`, where `totalPoints` is the full cumulative sum
across every round a player appears in. This is already fully generic
for N rounds — confirmed by 65 passing `multiRound.test.ts` cases
covering exactly this.

**My conclusion:** this is very likely a downstream symptom of bug #1
above, not a separate computation bug. If the round being viewed in
your screenshot was actually the chronologically-second round
(mislabeled "Round 3" by the naming bug), then "Previous = Round 1
only" would be the **mathematically correct** answer for that round —
it only looks wrong because the round's own label didn't match its
true position. I did not make speculative changes to this route, since
inspection shows it's already correct and generic — changing something
that passes inspection risks violating "do not rewrite working
architecture."

**This needs re-verification, not further code changes**, on a freshly
created 3-round trip (not the corrupted one from these screenshots) —
see the acceptance checklist below.

## 4. Side Games — grouped by round

**Found already correctly architected**, contrary to what the
screenshot suggested: `/api/trips/[tripId]/side-games` already fetches
every completed + active round via `selectRelevantSideGameRounds`
(built on the same canonical sorter) and returns them grouped;
`SideGamesClient.tsx` already renders one section per round with a
round-name header. This is not new work — it already existed in the
codebase before this round's changes.

**Two real gaps fixed:**
- Round names had the same stale-name bug as #1 — fixed by applying
  `getRoundDisplayName` in the `/side-games` route.
- A round with **zero** Side Games configured was silently omitted
  from the list entirely (`roundsWithContent` filtered it out) — this
  is very likely what actually produced "it looks like the app may
  still be showing the current round": Round 2 didn't get an empty
  state, it just vanished. Fixed to show every relevant round, with an
  explicit "No Side Games played this round" line for empty ones —
  matching your example output exactly.

## 5. Makers & Breakers — archetype explanations

Added a `definition` field to every one of the 28 archetypes (a single
new `ARCHETYPE_DEFINITIONS` lookup table in `makersBreakers.ts`,
injected centrally at the one place every archetype already converges
— not duplicated across 28 individual functions). Updated the
presentation slideshow (`MakersBreakers.tsx`) to the exact requested
structure: title → short reusable definition → player/group name → the
specific evidence that qualified them. Maverick's `statLine` had the
explanation phrase embedded directly in the evidence text ("— anything
could happen") — removed, since it's now shown once, correctly, as the
definition instead of duplicated inline.

**Scope note:** the compact, space-constrained surfaces (the
organiser's curation list in `MakersBreakers.tsx`'s `HighlightGroup`,
and the player's own personal-highlights card in
`PlayerRoundView.tsx`) were left unchanged — those are dense summary
rows, not the "explain the archetype" surface the brief describes, and
adding a full sentence there would clutter them. The full explanation
now lives on the primary presentation screen, where the archetype name
is the actual focal point.

---

## FILES CHANGED

- `multiRound.ts` — `getRoundDisplayName()` (new), `created_at` made
  optional in the ordering input type
- `tournament/page.tsx` — canonical sorter + created_at + display-name
  correction (My HQ, My Golf)
- `TripRoundsTab.tsx` — same, for round setup
- `TripDetailClient.tsx` — `created_at` added to `RoundRow`
- `page.tsx` (trip detail) — `created_at` added to all three rounds
  select variants (including fallback branches)
- `route.ts` (trip PATCH) — completed → live lifecycle revert
- `side-games/route.ts` — display-name correction
- `SideGamesClient.tsx` — show empty rounds explicitly
- `makersBreakers.ts` — `ARCHETYPE_DEFINITIONS`, `definition` field,
  Maverick statLine cleanup
- `MakersBreakers.tsx` — definition rendered in the presentation slide

## TESTS

- 224/224 `src/lib/scoring/**` pure-function tests pass, unchanged.
- 46/46 `src/lib/highlights/**` tests pass, unchanged (definition
  field is additive/optional, doesn't affect qualification logic any
  test exercises).
- No new tests added this round — `getRoundDisplayName` is a small,
  pure, easily-testable function and genuinely should get its own unit
  tests; that's a gap I'm flagging rather than one I closed, given the
  scope already covered this round.

## MIGRATIONS REQUIRED: No.

Nothing this round touches the database schema.

## ANYTHING STILL UNVERIFIED

Everything in this report is code-level verification only — no
browser, no live Supabase, no device from this sandbox. In particular:

1. **Item 3 (leaderboard)** — my conclusion that this is a downstream
   symptom, not a separate bug, is an inference from reading the code,
   not a confirmed fact. Please run the critical lifecycle test below
   specifically watching the leaderboard, and tell me directly if
   "Previous" is still wrong on a **freshly created**, correctly-dated
   3-round trip — if so, it's a real, separate bug I haven't found yet.
2. The trip lifecycle revert (item 2) has never been exercised against
   real data — needs the exact acceptance sequence below.
3. Whether `getRoundDisplayName`'s "Round N" pattern match correctly
   leaves every custom round name alone in practice (I only verified
   the regex logic, not against real trip data).

## ACCEPTANCE CHECKLIST FOR NEXT FIELD TEST

Per your test matrix, in order:

1. **2-round event:** R1 Complete, R2 Live. Check numbering, Side
   Games, My HQ, leaderboard previous/current/total all agree.
2. **3-round event created normally:** R1/R2 Complete, R3 Live. Confirm
   Previous = R1+R2, Current = R3, Total correct.
3. **Critical lifecycle test — the actual repro case:**
   - R1 Complete, R2 Complete → Trip Complete.
   - Add R3. Confirm: trip no longer Complete: R1 still Round 1, R2
     still Round 2, R3 is genuinely Round 3 and Upcoming.
   - Confirm leaderboard historical totals intact, no Side Games
     leakage across rounds, no Makers & Breakers leakage.
   - Complete R3. Confirm trip becomes Complete again.
4. **Side Games:** confirm Round 2 (no games) now shows "No Side Games
   played this round" instead of vanishing.
5. **Makers & Breakers:** confirm every archetype in the slideshow now
   shows its one-sentence definition under the title, before the
   player name and evidence.
