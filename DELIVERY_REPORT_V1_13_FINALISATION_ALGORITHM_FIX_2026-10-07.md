# SIDE GAME WINNER FINALISATION ALGORITHM FIX
## Delivery Report

NOT DEPLOYED, per your explicit instruction. No network access, no
live database connection, no browser or real device in this
environment -- the caveats below (item 8) are not a formality.

**The audit found something more serious than "may select a
different winner."** For every Side Game type except `longest_drive`,
the official finalisation function could never have set a winner at
all, ever, for any event. Full detail below.

---

## 1. WINNER-RULE MATRIX BY SIDE GAME TYPE

| Type | Live `computeRoundSideGames` rule | Old `finalize_side_comp_winners` rule | Canonical rule (established by the live screen + actual write paths) | Did they agree before this fix? |
|---|---|---|---|---|
| `longest_drive` | Most recent `side_comp_lead_changes` row whose entry is qualified+verified (walks backward, skipping invalid ones) | Most recent `side_comp_lead_changes` row, **no qualified/verified check at all** | Most recent qualifying lead change | **No** -- could diverge if the latest lead change's entry was ever unqualified/unverified |
| `nearest_pin` | Qualified+verified entry with the lowest `result_value`, read directly from `side_comp_entries` | Latest `side_comp_lead_changes` row -- **but nothing ever writes to this table for this type** | Best (lowest) qualifying `result_value` | **No -- official winner could never be set at all** |
| `pros_approach` | Same as `nearest_pin` (identical code branch) | Same as `nearest_pin` -- same table, same emptiness | Same as `nearest_pin` | **No -- same total failure to finalise** |
| `powerplay` | Never produces a `winner` (only a separate `powerplayBest`) | Never finalised (no lead changes, nothing to match) | No winner via this mechanism | Yes (both sides agree: never finalised) -- unchanged |
| `best_on_day` / `custom` | Falls into the same "else" branch as `nearest_pin` | Same total failure as `nearest_pin`/`pros_approach` | Same as `nearest_pin` | **No**, though confirmed inactive -- no API route currently submits to these types |

## 2. EXACT ROOT CAUSE

Confirmed by reading the actual write path, not assumed:
`src/app/api/trips/[tripId]/side-comps/[sideCompId]/entries/route.ts`
routes `nearest_pin`/`pros_approach` submissions to the
`submit_side_comp_value_entry` RPC. That RPC's current, authoritative
definition (migration 078 -- the latest `CREATE OR REPLACE` of it)
inserts **only** into `side_comp_entries`; it never writes to
`side_comp_lead_changes`. Only `longest_drive` submissions
(`submit_longest_drive_entry`) ever populate that table.

The previous `finalize_side_comp_winners()` (080, hardened in 082)
determined every Side Game's winner **exclusively** from
`side_comp_lead_changes`, with no branch by `comp_type`. For any type
other than `longest_drive`, that table is therefore always empty for
that competition -- the function's own CTEs find zero matching rows,
and `official_winner_entry_id` is **never set**, for any event, at
any time, no matter how many valid results exist.

A second, subtler gap surfaced during the same audit: even for
`longest_drive`, the old function took the single most recent lead
change unconditionally, with no qualified/verified check -- unlike the
live screen, which specifically walks backward to skip an invalid
most-recent entry. This is the same category of problem (official
finalisation silently diverging from what the live screen already
shows), fixed in the same migration.

## 3. EXACT FIX

New migration, `092_side_comp_finalisation_algorithm_fix.sql`,
`CREATE OR REPLACE FUNCTION public.finalize_side_comp_winners`, now
branching by `comp_type`:
- `longest_drive`: unchanged winner *concept* (most recent lead
  change), now joined against `side_comp_entries` with
  `qualified = true AND verification_status = 'verified'` applied
  **in the join itself**, before `DISTINCT ON ... ORDER BY
  sequence_number DESC` picks the latest -- so an invalid most-recent
  lead change is transparently skipped in favour of the next valid
  one, exactly mirroring the live screen's own backward walk.
- Every other type except `powerplay`: the qualified+verified entry
  with the lowest `result_value`, read directly from
  `side_comp_entries` -- exactly mirroring `computeRoundSideGames.ts`'s
  own "else" branch. A final `entry id` tiebreaker exists purely for
  SQL determinism on a true tie; it is not a claimed business rule,
  since neither the live screen nor the old SQL ever defined one.
- `powerplay`: unchanged -- explicitly excluded, never finalised by
  this function, matching the live screen (which never produces a
  `winner` for it either).

The existing idempotency guard (`WHERE official_winner_entry_id IS
NULL`) is preserved verbatim. Nothing about *who counts as a winner*
for a given dataset is a new business decision -- this makes official
finalisation compute winners using the exact rule the live screen
already uses and already shows players.

## 4. MIGRATIONS ADDED

One: `supabase/migrations/092_side_comp_finalisation_algorithm_fix.sql`
-- a new forward migration. Migrations 080 and 082 (the historical
definitions) were **not edited** -- confirmed directly: both still
contain their original `finalize_side_comp_winners` bodies verbatim,
and a dedicated test (item 5) asserts this.

## 5. TESTS ADDED/CHANGED, AND WHY

**No existing test was changed.**

18 new tests, in two files, covering your required scenarios 1-6
(scenario 6, "existing Side Game tests remain passing," is proven by
the full fresh suite result in item 6, not a new test of its own):

- `finaliseSideCompWinnerAlgorithm.ts` + `.test.ts` (10 tests) -- a
  pure, in-memory JS mirror of the real SQL's branching logic,
  specifically because no live Postgres connection exists here to run
  the actual function against. Covers: live/official agreement for
  `nearest_pin` and `pros_approach` directly (scenario 1); a later but
  worse result never beating an earlier better one (scenario 2);
  unqualified and unverified entries never winning regardless of
  result value (scenario 3); `longest_drive` picking the correct
  most-recent valid lead change, including skipping an invalid most-
  recent one (scenario 4, including the subtler gap fix); no
  qualifying result producing no winner for both value-based and
  `longest_drive` types, and `powerplay` never producing one at all
  (scenario 5).
- `sideCompFinalisationAlgorithmFix.test.ts` (8 tests) -- source-
  scanning contract tests against the real migration file's text
  (the same established pattern as the existing
  `sideCompWinnerHardening.test.ts`), confirming: this is a new file,
  not an edit to history; the real SQL genuinely branches by
  `comp_type`; the `longest_drive` path genuinely requires
  qualified+verified; the value-based path genuinely requires
  qualified+verified+non-null, ordered ascending (not descending);
  `powerplay` is excluded, not silently handled; the idempotency guard
  is unchanged; the migration touches nothing beyond this one function
  (no scoring, no table alterations).

**One honest note on my own process**: the first version of a
regex-based structural test (checking the `longest_drive_winner` CTE
body) initially failed -- not because the SQL was wrong, but because
my test matched against a SQL comment that the test's own
comment-stripping step had already removed before the check ran.
Caught immediately by actually running the test rather than assuming
it would pass, and fixed by matching against the next CTE's name
instead. Mentioned here because it's exactly the kind of mistake this
report should not quietly omit.

## 6. FRESH TARGETED AND FULL-SUITE COUNTS

Targeted, run first:
- `finaliseSideCompWinnerAlgorithm.test.ts`: 10/10 pass
- `sideCompFinalisationAlgorithmFix.test.ts`: 8/8 pass (after the one
  self-caught fix above)

Full suite, every package, run fresh after the targeted runs:
- `src/lib/scoring/**`: 301 pass (291 prior + 10 new)
- `src/lib/highlights/**`: 68 pass
- `src/lib/analytics/**`: 8 pass
- `src/lib/profile/**`: 7 pass
- SQL-scanning/migration contract tests: 71 pass (63 prior + 8 new)
- `src/lib/trips/**`: 228 pass, unchanged from the prior session --
  confirming the V1.12 Event Memories fallback fix remains fully
  intact (also confirmed directly by file inspection: `eventMemoryData.ts`
  was not touched this session; `computeRoundSideGames` and
  `resolveSideGameWinner` are both still wired in exactly as before)

**683/683, genuinely run fresh this session.**

## 7. HISTORICAL-DATA IMPLICATIONS

**No existing official winner is incorrect for `nearest_pin`,
`pros_approach`, `best_on_day`, or `custom`.** By the root cause in
item 2, the old function could structurally never have set
`official_winner_entry_id` for these types -- the table it queried was
always empty for them. Every existing row of these types therefore
has `official_winner_entry_id = NULL` today, with certainty, not by
inference about any specific event's data. There is nothing to
reconcile for these types -- only winners that were always missing
and can now be computed going forward, exactly like any other
previously-unfinalised Side Game (self-healing via
`get_my_golf_summary()`, a fresh Event Memories load using the V1.12
fallback, or an explicit future finalisation call). This migration
does not overwrite or clear any existing value -- it only changes what
a *future* call to `finalize_side_comp_winners()` computes for rows
still `NULL`.

**`longest_drive` is the one type where a genuine historical-accuracy
question exists**, from the subtler gap in item 2: if any
`longest_drive` Side Game, in any past event, happened to have its
single most-recent lead change belong to an entry that was
unqualified or unverified *at the moment the round was closed*, the
old function could have set an official winner that the live screen
itself would not have agreed was the actual leader at that moment.
**This cannot be checked from this environment** -- it requires a live
query of production data (specifically: for every closed round's
`longest_drive` Side Games, whether the entry matching the latest lead
change at close time was qualified+verified). No automatic
reconciliation was performed, per your explicit instruction. If you
want this checked, the query is a one-time, read-only comparison
against existing `official_winner_entry_id` values -- small in scope,
but it does need live database access to run.

## 8. REQUIRING LIVE VERIFICATION

- The historical `longest_drive` accuracy question in item 7, directly.
- That the new SQL function actually executes correctly against a
  real Postgres instance -- this was verified by careful manual
  reading and cross-checked by the JS behavioural mirror and the
  source-scanning contract tests, but has not been run against actual
  Postgres (no connection exists here). The SQL syntax was checked for
  structural soundness (balanced parens, correctly paired `$$`
  delimiters, a single `CREATE OR REPLACE FUNCTION`), not executed.
- Whether this migration, once deployed, actually causes Round 2's
  real Side Games to finalise correctly on the next round close --
  the same honest gap named in the prior pass's report, now one layer
  closer to resolved (the SQL bug that would have prevented it even
  after close is now fixed), but still unconfirmed against live data.
- Performance of the new `value_based_winner` CTE at real data volumes
  -- reasoned to be at least as cheap as the previous lead-change-based
  query (a single indexed `side_comp_entries` scan per round, same
  table the old function already read entries from in a later step),
  not benchmarked.
