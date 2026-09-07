# P0 -- SIDE-GAME CLAIMS FAIL IN 1 DIGITAL + 1 PAPER MODE
## Delivery Report

**Important context up front:** this exact bug had already been fully
traced and fixed via `supabase/migrations/076_side_comp_verifier_source_shared_device.sql`,
which was already present in the codebase when this brief arrived --
almost certainly from an earlier turn of this same engagement that got
summarised out of my visible context before this session began. My
work this round was verifying that fix is genuinely correct and
complete against your exact screenshots and acceptance test, not
writing it from scratch. Flagging this plainly rather than re-deriving
the same conclusion and presenting it as new work.

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run, and there is no live database
connection, so the actual fix has never executed against real
Postgres. All files touched syntax-check with zero errors. Full test
suite: **411/411 pass** (274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 7 SQL-scanning migration tests [including 2
new ones specific to this bug] + 54 trips).

---

## THE EXACT UNDERLYING ERROR -- LOGGED, NOT MASKED

Per your explicit instruction not to just patch the error message: the
route already logs the real Postgres error server-side
(`console.error('[side-comp entries] submit_longest_drive_entry
failed', { ..., error: error.message, code: error.code, details:
error.details, hint: error.hint })`) and -- as a deliberately
temporary measure for this exact investigation -- surfaces that same
detail to the client in a `debug` field, appended to the on-screen
error message. Your screenshots were taken before this was deployed,
so they show only the generic fallback text. Once deployed, the next
failed attempt (if any remain) will show the real constraint-violation
text directly on screen.

## ROOT CAUSE

A genuine Postgres `CHECK` constraint violation, confirmed by reading
the actual constraint definition and the actual function that violates
it -- not inferred from the error message alone.

`side_comp_entries.verifier_source` has had, since migration 047:
```
CHECK (verifier_source IN ('marker', 'organiser_fallback', 'self_verified_fallback'))
```

Migration 071 (the multi-group verifier-scoping fix from an earlier
session) added a fourth tier to `resolve_side_comp_verifier()` --
`'shared_device_partner'` -- specifically so a shared-device pair's
claims resolve to each other correctly. That migration never updated
this constraint to allow the new value.

**This exactly explains every symptom in your screenshots:**
- Fails for both self-submission (Alex, for himself) and proxy
  submission (Alex, for TEST) -- both resolve through the identical
  new tier, since in a 2-person shared-device group, "the other member
  of this pair" is the same answer regardless of who the claim is
  actually for.
- Fails identically for both Nearest the Pin and Longest Drive -- both
  comp types call the same `resolve_side_comp_verifier()` and write to
  the same table.
- Never previously reported for a normal Digital-to-Digital marker
  pair or an organiser-fallback scenario, because neither of those
  paths ever produces this specific verifier_source value.
- The generic "Couldn't save your result" text is exactly what the
  route falls back to when the RPC's real error message doesn't match
  the one specific string ('not currently active') it checks for.

## THE FIX

One migration, `076_side_comp_verifier_source_shared_device.sql`:
drops and re-adds the CHECK constraint with 'shared_device_partner'
included as a fifth valid value. Confirmed the actual current
constraint name (`side_comp_entries_verifier_source_check`) before
writing the DROP, rather than assuming Postgres's default naming.

**No RPC, no application code, no verifier-resolution logic changed at
all.** The resolution logic was always correct -- `resolve_side_comp_verifier()`
was already correctly identifying the shared-device partner as the
verifier; only the constraint validating what it's allowed to write
was left out of sync.

This means the fix satisfies your "do not solve this by pretending the
paper player is authenticated" requirement automatically -- nothing
about authentication or identity needed to change, since the actual
identity resolution (paper player's own player_id as the competitor,
entered_by as the real authenticated digital scorer) was already
correct before this fix and remains exactly the same.

## END-TO-END TRACE, PER YOUR EXPLICIT CHECKLIST

- **Does the mutation assume player_id === auth.uid()?** No --
  confirmed by reading `entries/route.ts` directly: `requestedPlayerId`
  defaults to the caller but is explicitly re-validated server-side
  against real trip_members/scorecards data whenever it differs, never
  trusted from the request body alone.
- **Is proxy/shared-device submission permitted by the API?** Yes,
  confirmed -- the same-group check in that route.
- **Does RLS block this?** Not implicated -- the actual failure is a
  table-level CHECK constraint, which fires regardless of RLS and
  would fire identically for the service-role admin client this route
  already uses.
- **Wrong ID type (trip_member_id vs profile_id vs user_id)?** Not
  implicated -- playerId is consistently a profiles.id throughout.
- **Missing group_id?** Not implicated -- the constraint violation
  happens before group_id is ever relevant to the write itself.
- **Side games scoped correctly to the round?** Yes, confirmed --
  side_comps.round_id is checked directly.
- **Does the read query exclude paper players?** Not reached -- the
  write itself was failing, so there was nothing to exclude; "No
  results yet" on the Side Games page was a downstream symptom of the
  write never succeeding, not a separate read-side bug.
- **Can the existing organiser/proxy logic be reused instead of a
  separate path?** Yes, and it already was -- this route's proxy
  mechanism is the one and only submission path for both self and
  proxy claims; nothing new was introduced.

## REGRESSION TESTS

Two new tests, `verifierSourceConstraint.test.ts`, added specifically
for this bug and re-run fresh this session:
1. A generic test that extracts every literal verifier_source value
   resolve_side_comp_verifier() can actually return (parsed directly
   from its own RETURN QUERY statements, not a hand-maintained list
   that could itself drift) and asserts every one is present in the
   constraint's allowed list -- this would catch this entire class of
   bug recurring if a future migration ever adds a fifth tier without
   updating the constraint in the same pass.
2. A specific test confirming 'shared_device_partner' is present.

**One thing worth surfacing directly:** this test file's own header
documents that its first draft had a real bug -- a naive text search
matched migration 076's own explanatory comment (which quotes the old,
broken constraint verbatim while describing the fix) instead of the
real, executable statement. Caught by running the test and reading the
actual failure, then fixed to strip SQL comments before matching.
Confirmed the current version passes for the right reason, not by
accident.

## FILES INVOLVED

- `supabase/migrations/076_side_comp_verifier_source_shared_device.sql`
  (the fix -- already present, verified correct)
- `src/lib/scoring/verifierSourceConstraint.test.ts` (regression tests
  -- already present, verified correct)
- `src/app/api/trips/[tripId]/side-comps/[sideCompId]/entries/route.ts`
  (unchanged this round -- contains the temporary debug-surfacing
  code, deliberately left in place until real-device confirmation, per
  that code's own comment)

No other files needed changes -- the resolution and submission logic
were already correct.

## FULL TEST RESULT

**411/411 pass** -- 274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 7 SQL-scanning migration tests + 54 trips.
Confirmed via a fresh, complete run this session.

## MIGRATION ORDER

`076_side_comp_verifier_source_shared_device.sql` comes after
everything already pending (070 through 075) -- correctly numbered,
nothing renumbered.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

This has never run against a live database. Your own acceptance test
is the right one to run, unchanged:

1. 9-hole round, 1 digital + 1 paper group, digital player scores both.
2. Add Longest Drive and Nearest the Pin.
3. Submit LD for the digital player -- should now save successfully.
4. Submit/update LD for the paper player -- should now save
   successfully.
5. Repeat for NTP.
6. Navigate to Side Games -- confirm no save error, correct current
   leader shown, paper player appears normally, result persists after
   refresh.
7. Confirm lead changes and any Moment/announcement logic work.
8. Confirm no regression to a normal all-digital group's Side Games,
   and no regression to organiser/proxy submission generally.

**If any of these fail on the device**, the debug detail now visible
on-screen (temporarily) should show the real error directly -- bring
that back rather than the generic message, since it's the fastest
path to whatever's actually still wrong, if anything is.
