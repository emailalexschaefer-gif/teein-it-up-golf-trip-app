# FINAL HARDENING -- OFFICIAL SIDE GAME WINNERS
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access -- npm run build was not run, and no migration has executed
against a live database. Migration 082 passes structural sanity
checks (balanced parens, even dollar-quote pairs), and its WITH-query
body is verified byte-identical to 081's real body except for the one
intended addition. Full test suite: **433/433 pass** -- the +7 over
the prior total is a new, dedicated contract-test suite for this
exact hardening, described below, including one real test bug I found
and fixed while writing it.

---

## 1. FAILURE/RETRY STRATEGY FOR FINALISATION

**Chosen: Option B** (best-effort at close, guaranteed self-healing on
every subsequent read), not Option A (making finalisation part of the
required close transaction).

**Why not A:** making finalize_side_comp_winners a hard requirement
for round close means a transient Side Games failure could block the
round from closing at all. An organiser unable to close a round over
a Side Games problem is a worse failure mode than a temporarily
unfinalised winner -- and the close route already carries enough
server-side guards (marker completion, shared-device detection) that
adding another hard dependency raises the chance of an unrelated
failure blocking a close that should otherwise succeed.

**Implementation:** get_my_golf_summary() -- called on every My Golf
read -- now reconciles first. For the requesting player's own
completed rounds, it finds any with a side_comp still missing
official_winner_entry_id and calls finalize_side_comp_winners()
again before computing the win count. This is safe specifically
because that function is already idempotent (confirmed directly
against its own WHERE ... IS NULL guard, not assumed) -- calling it
again costs nothing for anything already finalised. The exact scenario
your brief describes (close-time call fails, round still closes,
winner never becomes official) now self-corrects the next time that
player -- or, importantly, any player on that round -- opens My Golf,
with no cron job or separate recovery endpoint required.

## 2. INTEGRITY GUARANTEE BETWEEN SIDE_COMP AND WINNER ENTRY

**Investigated before concluding anything, per the explicit
instruction.** Read side_comps' actual RLS policy directly:
"Organisers: manage" grants FOR ALL (including UPDATE) on every
column, official_winner_entry_id included. A plain FK alone does not
stop an organiser's client -- or any future code path -- from writing
an entry ID belonging to a completely different competition. This was
a genuine gap, not a theoretical one, confirmed by reading the policy
rather than assumed from the schema alone.

**Fix:** a BEFORE INSERT OR UPDATE OF official_winner_entry_id
trigger on side_comps, enforced at the database level regardless of
caller. It looks up the referenced entry's own side_comp_id and
raises an exception if it doesn't match the row being written to.
This applies identically whether the write comes from
finalize_side_comp_winners, a direct organiser client call, or
anything else -- stronger than documenting "only the trusted function
writes this," which your own brief correctly flagged as insufficient
on its own.

## 3. CONFIRMATION: WINNER ATTRIBUTION USES THE COMPETITOR

Confirmed directly in the redeclared my_side_game_wins CTE:
sce.player_id = p_player_id, where sce is the winning
side_comp_entries row -- never entered_by, never a verifier field,
never the authenticated caller. This was already correct in migration
081 and is unchanged here; verified again explicitly for this report,
and now also locked in by an automated test (below) that would fail
if a future edit ever introduced entered_by or verifier into this
CTE. This matters most for Digital + Paper/shared-device Side Games,
where the person entering or verifying a claim is very often not the
competitor who actually won -- the win correctly follows the
competitor regardless.

## 4. HISTORICAL BACKFILL SAFETY

Re-verified migration 080's existing backfill against every point in
your checklist:
- Only touches rounds WHERE status = 'completed' -- confirmed.
- Only selects from side_comp_lead_changes (verify-only-written,
  confirmed against migration 047 in the prior delivery) -- never
  infers from unverified claims.
- A side_comp with no lead-change rows is never present in the
  winning_entry CTE, so it's simply never updated -- stays NULL, no
  fabricated winner.
- Cannot cross-assign a different competition's entry -- now
  additionally guaranteed at the DB level by the new trigger (item 2),
  not solely by the function's own correct join logic.
- Never touches side_comp_entries, side_comp_lead_changes, or
  moments -- only ever UPDATEs side_comps.
- Safe if retried -- the backfill and the live path are the literal
  same function, gated by the same idempotency guard.

No further migration changes were needed for this item -- the existing
design already satisfied it; the new trigger adds defence in depth on
top of it.

## 5. TESTS ADDED

New file, sideCompWinnerHardening.test.ts -- 7 source-scanning
contract tests against the real migration files (no live Postgres
connection exists here, so these verify the actual deployed SQL text
directly, the same discipline used for prior untestable SQL in this
engagement):
1. The idempotency guard is genuinely present in finalize_side_comp_winners's own WHERE clause.
2. my_side_game_wins counts sce.player_id, never entered_by/verifier.
3. my_side_game_wins no longer references trip.status at all.
4. The self-healing call happens before the win count is computed, not after.
5. The self-healing loop is scoped to status = 'completed' rounds only.
6. The integrity trigger's function body genuinely compares
   side_comp_ids and raises an exception -- not just a named,
   empty trigger.
7. The redeclared get_my_golf_summary's query body is byte-identical
   to 081's, except for the one intended addition.

**Caught and fixed a real bug in my own first draft while writing
these**, worth surfacing directly: test 1 initially assumed the
idempotency guard's two conditions appeared consecutively in the
WHERE clause; the real SQL has a third condition
(sc.id = we.side_comp_id) between them, so the test failed on its
first run. Fixed by extracting the actual UPDATE ... WHERE ...
RETURNING block specifically and checking within it, then re-ran to
confirm all 7 pass for the right reason -- not adjusted to make a
false result look green.

## 6. NEW TOTAL TEST RESULT

**433/433 pass** -- 289 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 14 SQL-scanning migration tests (7 existing +
7 new) + 54 trips. Confirmed via a fresh, complete run this session.

## 7. ANYTHING STILL REQUIRING LIVE DB/DEVICE VALIDATION

Everything in this delivery, and the two before it -- nothing here has
touched a live Postgres instance. Specifically for this hardening
pass:
1. Confirm the integrity trigger actually fires and rejects a
   deliberately mismatched official_winner_entry_id (a genuine
   negative test only a live database can perform).
2. Confirm the self-healing path genuinely recovers a deliberately
   "stuck" round (manually leave a completed round's side_comp
   unfinalised, then open My Golf and confirm it resolves).
3. The full multi-round acceptance test from the prior brief, now with
   the added confidence that a transient failure won't be permanent.

## FILES CHANGED

- `supabase/migrations/082_side_comp_winner_hardening.sql` (new)
- `src/lib/scoring/sideCompWinnerHardening.test.ts` (new -- 7 tests)

No application (TS/TSX) files changed in this pass -- the round-close
route's existing best-effort call from the prior delivery required no
changes; the retry mechanism lives entirely in the redeclared SQL
function instead.
