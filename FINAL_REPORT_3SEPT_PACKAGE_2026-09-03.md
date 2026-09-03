# TEEIN' IT UP — 3 SEPTEMBER 2026 LIVE-DEVICE BUG + UX PACKAGE
## Final Consolidated Report — Items 1–9 Complete

**Build/test caveat, unchanged from every prior round:** no network
access — `npm run build` was not run, and there is no live database
connection. All 9 touched application files syntax-check with **zero
errors**, verified fresh this session, not carried forward. Full test
suite: **409/409 pass** (274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 5 SQL-scanning migration tests + 54 trips) —
every suite actually run this session, by exact command, listed below.

**This is one complete package. Nothing was deployed or packaged
separately for items 1–5.**

---

## FINDINGS / ROOT CAUSE BY ITEM

**Item 1 — onboarding at signup.** Investigated, not modified. The
gate (`(app)/layout.tsx`, checking `user_intent IS NULL` + account age
under 15 minutes) traces through correctly end to end. Per your own
explicit instruction, code inspection does not overrule the device
result — **the next deployment must include a genuine brand-new signup
test** (signup -> Player/Organiser/Both -> organiser types -> Profile)
before this is considered confirmed working in production, regardless
of what the code shows.

**Item 2 — Finalize Round hole review.** Already implemented
(`hasValidLibraryData` conditional, correctly gated on a genuinely
complete Course Library snapshot). Only the button wording didn't
match the brief's exact text — fixed to "Confirm & Continue ->" on both
the primary skip path and the post-edit path, no logic changed.

**Item 3 — Refresh Playing Partner.** Real gap: the "Waiting for
[Player]" panel had no manual refresh action. Fixed. Confirmed by
inspection (not assumption) that this panel structurally cannot show
for a shared-device Paper partner — their card resolves directly from
`allCards`, never depending on them having "started," so `!markedScorecard`
is always false for that case.

**Item 4 — photo cropper.** Two distinct issues, addressed separately:
1. `maxZoom` was a single hardcoded constant regardless of image
   resolution — fixed with per-image dynamic computation via
   `onMediaLoaded`.
2. **The actual reported problem, per your explicit correction:** the
   crop frame's aspect ratio (`4:3`, hardcoded regardless of source
   orientation) was itself the constraint — a portrait photo forced
   into a landscape frame means the mandatory "cover" zoom floor
   already discards most of the image's height, with no zoom value in
   either direction able to recover it. Fixed by pre-detecting the
   source image's real orientation before the crop UI ever mounts, and
   using the reciprocal (portrait) ratio when appropriate. This is the
   genuine geometry fix, not a slider adjustment.

**Item 5 — Round Summary sync.** Investigated first, as instructed —
found a real root cause, not just a missing button: `syncScoreQueue`
only ever ran on three specific triggers (mount, queueing a new entry,
the browser's `online` event), confirmed by that file's own code
comment admitting no periodic retry existed by design. A merely slow
or intermittently-failing connection — not a full offline/online
transition — could leave a queue stuck with nothing to retry it,
especially post-round when no further scores are being entered. Fixed
the underlying timing gap (bounded 8-second retry while genuinely
pending) *and* added the manual "Sync Now" button as the explicit
fail-safe.

**Item 6 — Group Makers & Breakers roster.** The calculation engine
was not touched. `groupId`/`groupName` already existed on published
highlights; the player roster was already fully computed internally by
every group finder (`bucketByGroup`), just never surfaced into the
returned object. Added a `roster` field, wired into all 12 group
archetype functions. The round-specific-snapshot data rule was already
correctly satisfied upstream (via migration 070's `scorecards.group_id`
fix) — confirmed, not assumed. "Playing Group N" fallback applied at
the display layer only. Found and fixed a related bug while
implementing this: the presentation slideshow showed a blank name line
for every group highlight (since `playerName` is intentionally empty
for group scope) — now shows group identity + roster instead.

**Item 7 — publish once, lock.** The server-side persistence
(`published_round_highlights`) was already fully correct — round-scoped
via a `UNIQUE(round_id)` constraint, organiser-write-gated, confirmed by
reading the existing route directly. The entire gap was client-side:
My HQ's curation screen never checked for an existing published record
before offering to regenerate. Fixed: on mount, the published state is
checked first; if it exists, the generate/curate flow never runs at
all, and a genuine read-only view renders instead — no edit/regenerate
control anywhere in that view.

**Item 8 — leaderboard publication.** New component
(`RoundHighlightsSection`), reads only the same published-highlights
endpoint item 7 already uses — never regenerates. Renders nothing
before publication (the existing privacy rule). Round 1/Round 2
isolation is structurally guaranteed by the same `UNIQUE(round_id)`
constraint, not something this component enforces itself.

**Item 9 — round vs. event separation.** Verified, not modified.
Confirmed by direct inspection that `FinalEventResults.tsx`/
`final-results/route.ts` use `generateEventMakersAndBreakers` — a
completely separate function from the round-level engine, computed
live, never reading or writing `published_round_highlights`. Items 6–8
touch only the round-level system; zero lines changed in the
event-level files.

---

## FILES CHANGED

- `src/components/scoring/BeginRoundModal.tsx` (item 2, wording only)
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx` (items 3, 5)
- `src/components/shared/ImageCropper.tsx` (item 4)
- `src/lib/db/sync.ts` (item 5)
- `src/lib/highlights/makersBreakers.ts` (item 6 — `roster` field, 12 sites)
- `src/lib/highlights/makersBreakers.test.ts` (item 6 — 2 new tests)
- `src/components/scoring/MakersBreakers.tsx` (item 7, plus item 6's slideshow fix)
- `src/components/scoring/RoundHighlightsSection.tsx` (item 8, new)
- `src/components/scoring/LiveLeaderboard.tsx` (item 8, wiring)

**Explicitly not touched:** the calculation engine in
`makersBreakers.ts` (only the return objects gained one new field, no
threshold/qualification logic changed), `eventMakersBreakers.ts`,
`final-results/route.ts`, `FinalEventResults.tsx`, the
`published_round_highlights` API route itself (only its existing GET
response is now actually consumed correctly by the client).

## MIGRATIONS

**None required for items 6–9.** `roster` is a new field on the
in-memory `Highlight` type, flowing into `published_round_highlights.highlights` —
already a flexible JSONB column, no DDL change needed. Confirmed no new
migration file exists beyond the four already pending from the prior
session.

**Still pending from the prior session, unchanged, in this exact
order:**
1. `070_begin_round_writes_group_id.sql`
2. `071_fix_side_comp_verifier_group_scoping.sql`
3. `072_enable_rls_side_comps_pre_sprint9_backup.sql`
4. `073_profile_user_intent.sql`

## TESTS ADDED/CHANGED

- 2 new tests in `makersBreakers.test.ts` (item 6): roster correctness
  using the brief's own real-device example ("The Closers"), and a
  cross-group-leakage guard confirming a third player in a different
  group never appears in another group's roster.
- No new tests were warranted for items 2/3/5/7/8 — each is either a
  UI wiring change to an already-tested underlying data source
  (published-highlights, sync queue), or copy/wording only.

## FULL TEST RESULT — EXACT COMMANDS AND COUNTS, RUN THIS SESSION

| Suite | Basis | Result |
|---|---|---|
| scoring (pure-function) | `node --test *.test.js` on transpiled `src/lib/scoring` (excluding the 2 SQL-scanning files, run separately below) | **274/274 pass** |
| highlights | `node --test *.test.js` on transpiled `src/lib/highlights` | **61/61 pass** |
| analytics | `node --test *.test.js` on transpiled `src/lib/analytics` | **8/8 pass** |
| profile | `node --test *.test.js` on transpiled `src/lib/profile` | **7/7 pass** |
| scoring (SQL-scanning) | `node --test beginRoundMigration.test.js verifierScopingMigration.test.js`, run in their real project location (these read actual migration files from disk via `process.cwd()`) | **5/5 pass** |
| trips | `node --test *.test.js`, run in their real project location (same file-reading requirement) | **54/54 pass** |

**Total: 409/409 pass.** Every suite listed was actually executed this
session — this is not a carried-forward number.

---

## WHAT STILL REQUIRES REAL-DEVICE VERIFICATION

1. **Item 1 — the actual next-deployment signup test**, per your
   explicit instruction: a genuinely brand-new account, signup ->
   Player/Organiser/Both -> organiser types (if applicable) -> Profile
   showing the same saved answers. Code inspection alone does not close
   this out.
2. **Item 4 — the specific acceptance criterion you set**: load a
   large portrait photo into Frame Your Moment and confirm you can now
   see/frame meaningfully more of it than before, with no blank crop
   area, for both an uploaded photo and a camera-captured one.
3. Item 2's Confirm & Continue path on a real Course Library round.
4. Item 3's exact acceptance sequence (Digital A starts, B starts
   later, A taps refresh, B's card appears immediately) — and the
   explicit Paper-player non-regression check alongside it.
5. Item 5's Sync Now under genuinely poor course reception, plus
   confirming the new periodic retry actually shortens real stuck-queue
   time rather than just adding a button.
6. Items 6–8 together: generate -> select -> publish -> leave My HQ ->
   return -> confirm the exact same read-only cards persist, on another
   device, and that the leaderboard's collapsed section shows the same
   published selection with working roster expand/collapse.
7. Multi-round: confirm Round 2 publishing does not alter Round 1's
   already-published record, and Round 1's leaderboard never shows
   Round 2 content.

---

## REAL-DEVICE ACCEPTANCE CHECKLIST

**A. Onboarding** — new account, Player/Organiser/Both work, organiser
types conditional, Profile shows saved result, existing user not
gated.

**B. Finalize Round** — Course Library round skips hole editor via
Confirm & Continue; Review/Edit Holes still works when deliberately
chosen.

**C. Partner refresh** — Digital B starts after A; A taps Refresh
Playing Partner; B appears immediately, no navigation/restart.

**D. Paper regression** — Paper card still appears automatically, no
login/start requirement, no waiting-state regression.

**E. Photo** — portrait, landscape, camera, gallery upload; confirm
genuinely more of a large portrait is visible than before; zoom out
and in both usable; no blank crop area; save works.

**F. Round Summary sync** — Sync Now works, count decreases correctly,
zero-pending unlocks confirmation, no duplicate/lost scores, automatic
retry still works.

**G. Group Makers & Breakers** — group number/name shown, "Players (N)
v" expands to the correct historical roster.

**H. Publication** — generate, select, publish, leave My HQ, return:
exact same read-only cards, no regenerate option.

**I. Leaderboard** — Round 1 published M&B appear beneath Round 1
standings, expand/collapse works, roster works; Round 2 gets its own,
separate published set.

**J. Event level** — Event Winner and Event-level M&B remain in My HQ,
unaffected by any of the round-level changes above.
