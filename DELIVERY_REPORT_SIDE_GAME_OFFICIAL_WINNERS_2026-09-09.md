# MY GOLF SIDE GAMES -- LIVE STATUS + OFFICIAL ROUND WINNERS
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access -- npm run build was not run, and no migration has executed
against a live database. All 4 touched/new TS/TSX files syntax-check
with zero errors. Both new SQL migrations pass structural sanity
checks (balanced parens, even dollar-quote pairs). Full test suite:
**426/426 pass** -- identical to the prior total, confirming this
pass changed no existing pure-function calculation.

---

## 1. SCHEMA CHOSEN

Two nullable columns on the existing side_comps table:
official_winner_entry_id UUID REFERENCES side_comp_entries(id) and
finalised_at TIMESTAMPTZ. Not a new table -- confirmed by reading the
actual side_comps/side_comp_entries schema first: side_comps already
has exactly one row per competition, so a column on that row
representing "the official result" is narrower than a satellite table
for a single nullable reference.

## 2. MIGRATION ADDED

- 080_side_comp_official_winners.sql -- the two columns, a new
  finalize_side_comp_winners(p_round_id) function, and a one-time
  backfill for every already-completed round.
- 081_my_golf_summary_official_side_game_wins.sql -- redeclares
  get_my_golf_summary(), changing only the my_side_game_wins CTE;
  every other CTE reproduced verbatim from the real current 075 body,
  confirmed via an exact diff before finalising the file (the diff
  shows only the one intended block changed).

## 3. HOW OFFICIAL WINNER IS DETERMINED

Confirmed by reading migration 047 directly before using it:
side_comp_lead_changes is written only by the verify RPCs
(verify_side_comp_value_entry, verify_longest_drive_entry), never
by claim submission -- its latest row (by sequence_number) per
side_comp_id is therefore already "the current, verified leader," the
exact same query get_my_golf_summary() already used. Reused directly,
not reinvented, per the explicit "do not invent new ranking logic"
instruction -- confirmed this applies identically to Nearest the
Pin/Pro's Approach (numeric comparison) and Longest Drive (ordinal
confirm/reject), since both write to the same
side_comp_lead_changes table through the same mechanism regardless
of comp type.

## 4. EXACT ROUND-CLOSE INTEGRATION POINT

/api/trips/[tripId]/rounds/[roundId]/close/route.ts, immediately
after rounds.status successfully updates to 'completed' and before
the existing trip-lifecycle check. A single
admin.rpc('finalize_side_comp_winners', { p_round_id: roundId })
call, best-effort (logged on failure, never rolls back or blocks the
round close itself) -- matching this route's own existing pattern for
its adjacent trip-completion hook.

## 5. HOW IDEMPOTENCY IS GUARANTEED

At the database level, not client state, per the explicit instruction:
finalize_side_comp_winners()'s own UPDATE is scoped
WHERE sc.official_winner_entry_id IS NULL. Once set, a side_comp is
permanently finalised -- re-running the function (a retried close, a
duplicate call, anything) is a guaranteed no-op for any side_comp
already finalised, since the WHERE clause itself excludes it from
being touched again. Reading summary data (get_my_golf_summary) never
writes anything at all, so it cannot affect win counts by
construction, not merely by convention.

## 6. HOW MULTI-ROUND EVENTS NOW WORK

my_side_game_wins in the redeclared get_my_golf_summary() reads
side_comps.official_winner_entry_id IS NOT NULL directly -- set the
moment that specific round closes, entirely independent of
trips.status. Round 1's winner counts the instant Round 1 closes,
regardless of whether Round 2 or the trip itself is still live --
directly resolving the confirmed architectural gap from the audit.

## 7. HOW LIVE MY SIDE GAMES STATUS IS CALCULATED

New route, /api/trips/[tripId]/rounds/[roundId]/my-side-games,
reading the same side_comp_lead_changes latest-row query. Reports
exactly two states -- "Current Leader" (this player's entry is the
side_comp's current leader) and "Result Entered" (they have an entry
but aren't leading). Deliberately does not compute a full 2nd/3rd
ranking -- confirmed Longest Drive uses ordinal confirm/reject
(no numeric result_value at all) while Nearest the Pin/Pro's Approach
compare distances, genuinely different ranking models; a combined
ordinal position across both under time pressure risked inventing
new, unverified logic, which the brief explicitly warned against. Two
states that are correct for every comp type by the same simple rule
was the safer, still-useful scope. Never returns "Winner" -- confirmed
by there being no reference to official_winner_entry_id's value
anywhere in this route's own response construction.

Mounted as MySideGamesSection, positioned inside PlayerRoundView's
Recap Round exactly where an earlier brief specified: My Group -> What
Happened Today -> Your Highlights -> My Side Games -> My Moments.

## 8. HOW GET_MY_GOLF_SUMMARY() CHANGED

Described fully in items 3 and 6 above. Summarised: one CTE replaced,
everything else byte-identical, verified via diff.

## 9. HOW HISTORICAL WINS ARE HANDLED/BACKFILLED

Migration 080's own DO $$ ... $$ block runs
finalize_side_comp_winners() once for every round already
status = 'completed' at migration time, using the exact same "latest
verified lead change" rule as new closures going forward -- not a
separate, ad-hoc historical calculation. Non-destructive: only ever
writes into a currently-NULL column, never touches
side_comp_entries, side_comp_lead_changes, or deletes/reinterprets
any existing row. Duplicate historical winners are prevented by the
same WHERE official_winner_entry_id IS NULL guard used for live
closes -- the backfill and the live path are the literal same
function, not two implementations that could drift or double-count
against each other.

## 10. FILES CHANGED

- `supabase/migrations/080_side_comp_official_winners.sql` (new)
- `supabase/migrations/081_my_golf_summary_official_side_game_wins.sql` (new)
- `src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts` (finalisation call)
- `src/app/api/trips/[tripId]/rounds/[roundId]/my-side-games/route.ts` (new)
- `src/components/scoring/MySideGamesSection.tsx` (new)
- `src/components/scoring/PlayerRoundView.tsx` (mount point)

## 11. TESTS ADDED

None new. Both migrations were verified by structural sanity checks
(balanced parentheses, even dollar-quote pairs) and, for 081, an exact
diff against the real current 075 body confirming only the intended
CTE changed -- the same verification discipline used for prior SQL
work in this engagement, since neither of these can be executed
directly in this sandbox (no live Postgres connection). No new
pure-function logic was extracted from the TS/TSX changes -- they are
API routes and a display component reading persisted data, not new
calculation logic distinct from what the SQL functions above already
compute.

## 12. FULL TEST-SUITE RESULT

**426/426 pass** -- 289 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 7 SQL-scanning migration tests + 54 trips.
Identical to the prior session's total, confirming zero regression to
any existing calculation.

## 13. ANYTHING NOT COMPLETED

- **Live 2nd/3rd ranking** (mentioned as a "may include" state in the
  brief) was deliberately scoped out of item 4's live status route,
  for the reasons in section 7 above -- a real, named simplification,
  not an oversight.
- **Nothing in this delivery has been run against a live database or
  a real device.** The multi-round acceptance test (Round 1 closes
  while trip/Round 2 remain live, refresh does not duplicate, Round
  2's own winner also finalises correctly) and the no-result
  acceptance test (a side_comp with no valid verified entry closes
  with official_winner_entry_id staying NULL) both need real-device
  confirmation before this can be marked genuinely complete, per the
  brief's own explicit closing instruction.
- Item 7 of the brief (Event/Player Story, badges/points consumption
  of the persisted official winner) was not built -- this delivery
  establishes the one canonical official_winner_entry_id value those
  systems could read from, but none of them were wired to actually
  read it in this pass.
