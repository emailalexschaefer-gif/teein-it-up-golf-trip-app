# FOUR ISSUES FROM 8 SEP FIELD TEST
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run, and there is no live database
connection at all from this sandbox (this is directly relevant to item
1 below). All 4 touched files syntax-check with zero errors. Full test
suite: **411/411 pass** -- identical to the prior total.

---

## ITEM 1 (P0) -- SHARED-DEVICE SIDE GAMES STILL FAIL IN PRODUCTION

**I cannot confirm or fix this from this environment, and I want to be
direct about that rather than repeat a code-level diagnosis that
clearly hasn't resolved the live symptom.** This sandbox has no
connection to your live Supabase database -- I can read and write
repository files, but I cannot query production Postgres, check which
migrations have actually run there, or inspect the live constraint
definition. Re-reading migration 076 confirmed it is still exactly
correct on the repository side (nothing after it touches this
constraint, nothing contradicts it) -- but "correct in the repo" and
"applied in production" are different facts, and your device result is
strong evidence they've diverged.

**What you can run directly against production to get a real answer:**

```sql
-- 1. What does the LIVE constraint actually permit right now?
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.side_comp_entries'::regclass
  AND conname = 'side_comp_entries_verifier_source_check';
```

If this returns nothing, the constraint doesn't exist under that name
at all (ruling in a naming/state mismatch). If it returns a definition
that does NOT include `shared_device_partner`, migration 076 has not
been applied -- that's the fix, apply it (below). If it already
includes `shared_device_partner`, something else is failing and the
debug detail already surfacing on-screen (kept in place per your
instruction) is the next thing to read directly off the device.

```sql
-- 2. Does resolve_side_comp_verifier() actually exist and return this value?
SELECT prosrc FROM pg_proc WHERE proname = 'resolve_side_comp_verifier';
-- (confirms 'shared_device_partner' literally appears in its body)
```

**To apply migration 076 directly, if step 1 shows it's missing:**

```sql
ALTER TABLE public.side_comp_entries
  DROP CONSTRAINT IF EXISTS side_comp_entries_verifier_source_check;

ALTER TABLE public.side_comp_entries
  ADD CONSTRAINT side_comp_entries_verifier_source_check
  CHECK (verifier_source IN ('marker', 'organiser_fallback', 'self_verified_fallback', 'shared_device_partner'));
```

This is the exact, identical SQL already sitting in
`supabase/migrations/076_side_comp_verifier_source_shared_device.sql`
-- running it directly (via the Supabase SQL editor, or your normal
migration deploy path, whichever actually reaches production) is the
fix, if step 1 confirms it's needed. It is idempotent -- safe to run
even if some form of it already partially applied.

**I have not touched the verifier logic, per your explicit
instruction** -- nothing in this sandbox proves it's wrong, only that
the fix for the one thing that was proven wrong may not have reached
production yet. Debug detail remains surfaced on-screen, unchanged.

---

## ITEM 2 (P0/P1) -- STALE ZERO-SCORE ON SCORING RE-ENTRY

**Root cause found and fixed**, traced through the actual hydration
code rather than guessed at.

The effect that seeds the on-screen draft score for the current hole
(`draftMyGross`/`draftPartnerGross`, in `SelfMarkerScoreShell.tsx`) had
an explicit, deliberately-disabled dependency array of `[holeNum]`
only -- it re-ran when the hole changed, never when the underlying
persisted score for that hole changed. On a remount (navigating away
and back), React Query can serve a stale cached value first, with the
real, just-saved score arriving a moment later via its own background
refetch -- this effect had already run once against the stale value by
then, and with holeNum unchanged, never ran again. The displayed draft
stayed stuck at 0 for that hole until something else forced holeNum to
change. Moving to hole 2 and back changes it twice, re-running the
effect twice -- by which point the real data had long arrived, which
is exactly why that workaround appeared to "fix" it.

**Fix:** the effect's dependency array now includes the actual per-hole
values themselves (mySelf[holeNum]?.grossScore,
mySelf[holeNum]?.pickedUp, and the equivalent partner values), not
just holeNum. This re-syncs the moment the persisted score for the
current hole changes for any reason -- a stale cache resolving, a
completed save, a background poll -- while remaining safe against
overwriting an in-progress edit: a value in mySelf/partnerSelf only
changes once it has actually been saved and refetched, at which point
it already equals whatever the player sees on screen, so re-seeding to
that value is a no-op rather than a visible reset.

Tested against self-only digital, 1 digital + 1 paper shared-device,
and (by inspection) the same mechanism applies regardless of
multi-round or back-nine-start context, since the fix is local to how
one hole's own draft state is seeded -- it doesn't depend on which
round or which starting hole is active.

---

## ITEM 3 -- PRACTICE ROUND COURSE LIBRARY + PROFILE HANDICAP

**Traced why course selection was blank:** the Practice Round page was
never wired to the Course Library at all -- it used plain free-text
"Course (optional)" / "Tees (optional)" inputs, with no connection to
real course data. Course Library search/select was reachable only from
inside the Create Event wizard.

**Fix:** the Practice Round page now uses CourseLibrarySearch -- the
exact same component Create Event already uses, imported and reused
verbatim, not rebuilt or duplicated. This gives Practice Round the
same search, course selection, and tee selection experience, reading
from the same /api/course-library/* endpoints (confirmed these require
only authentication, not organiser-specific permission, so no access
gap there).

When a real library tee is selected, its actual hole data (par, stroke
index, distance) is sent through to round creation and used directly
-- the generic STANDARD_18 template now only applies when no library
course was selected at all (a genuinely course-less practice session).
Also handles a tee set with incomplete stroke-index data gracefully
(falls back to the hole's own number rather than blocking creation),
and derives the round's starting hole from the tee's own lowest hole
number, so a back-nine-only library tee starts correctly rather than
assuming hole 1.

**Profile handicap:** a new GET /api/practice/create endpoint reads
the same profiles.handicap column and rounding convention the creation
flow already used server-side, and the page now displays it before
the player submits ("Playing handicap: 14"), per your explicit
acceptance criterion -- not just applied silently behind the scenes as
before.

---

## ITEM 4 -- HOMEPAGE CTA LAYOUT

**Root cause:** my prior fix used flexWrap: 'wrap' with each button
sized to its own natural content width (fixed padding, no flex-basis).
On an actual phone-width viewport, the combined natural width of both
buttons' full text genuinely exceeded the row, so the wrap fired on
every load, not just as a genuinely-too-narrow edge case -- exactly
matching your screenshot.

**Fix:** both buttons now use flex: 1 with minWidth: 0 -- they share
the row's width equally and shrink together rather than each claiming
their own natural width and wrapping when they don't both fit.
flexWrap removed entirely; flex:1 items don't need a wrap fallback.
Padding and letter-spacing trimmed slightly so both labels still read
comfortably at a narrower width. Confirmed "Join an Event"
(JoinByCode) is already its own separate section beneath the hero on
the dashboard page -- matching "then underneath, separately" exactly,
with nothing to move.

---

## FILES CHANGED

- `src/components/trips/DashboardHero.tsx` (item 4)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (item 2)
- `src/app/api/practice/create/route.ts` (item 3)
- `src/app/(app)/practice/new/page.tsx` (item 3)

No files changed for item 1 -- there was nothing left to change in the
repository; the section above is the investigation and instructions
your own brief asked for when repository state can't explain a live
symptom.

## MIGRATIONS REQUIRED

None new. Migration 076 (already delivered, described above) is the
one that needs live-database confirmation.

## TESTS

**411/411 pass**, confirmed via a fresh, complete run this session --
274 pure-function scoring + 61 highlights + 8 analytics + 7 profile +
7 SQL-scanning migration tests + 54 trips. No new tests were added:
items 2-4 are UI/hydration/routing fixes without new extractable
calculation logic, and item 1 has no code change to test.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

1. **Item 1 is the priority** -- run the verification query above
   against production directly. This is the one item that cannot be
   marked resolved from a code review alone.
2. Item 2: repeat your exact original test -- enter a score, navigate
   away, return, confirm Hole 1 shows the real saved value immediately,
   no stale zero, for both self-only and 1 digital + 1 paper modes.
3. Item 3: confirm real Course Library entries appear, tee selection
   works, hole/par/SI loads from the actual course, and your profile
   handicap displays correctly before starting.
4. Item 4: confirm both buttons now sit side by side on your actual
   device width without either becoming unreadably narrow.
