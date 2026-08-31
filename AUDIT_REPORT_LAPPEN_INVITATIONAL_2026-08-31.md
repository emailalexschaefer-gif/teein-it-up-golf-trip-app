# P0 PRE-FLIGHT AUDIT — DARREN'S EXISTING 20-PLAYER LIVE EVENT
## "Lappen Invitational" (24–25 Oct 2026) — Audit Report, 31 Aug 2026

**This was inspection-only, per the explicit instruction. Nothing was
modified, deleted, recreated, migrated, or backfilled.**

**Sandbox caveat, stated upfront and honestly:** this environment has
no live connection to your production Supabase database. I cannot
literally run `SELECT * FROM trip_groups WHERE trip_id = ...` against
Darren's actual trip and show you real rows. What I *can* do, and did
do, is trace the complete, current codebase and migration history to
determine — with high confidence, from the code and schema themselves
— what the answer would be. Where that falls short of a live query,
I say so explicitly rather than presenting a code trace as if it were
a database result.

---

## THE HEADLINE ANSWER

**Yes — if you leave these 20 memberships untouched and Darren creates/
finalises groups and starts scoring now, every subsequent record will
be generated through the current, corrected code. There is no
mechanism anywhere in this codebase that locks a trip to older logic
based on its creation date, and every piece of data that matters for
the stages ahead of you is either (a) plain relational membership data
with no embedded business logic, or (b) not yet created at all.**

The one thing I cannot confirm from this sandbox — and the one real
gate before you proceed — is whether migration 069 (today's
scoring_method fix) has actually been applied to your live database.
That's the specific, narrow thing to verify, not a reason for broader
concern about the trip as a whole.

---

## Why — traced through the actual lifecycle, not assumed

### 1. Trip, trip_members, profiles — confirmed safe, by design

These are plain relational rows: `trips(id, organiser_id, name,
dates, status, ...)`, `trip_members(id, trip_id, profile_id, role,
group_id, ...)`, `profiles(...)`. None of them embed any business
logic, computed value, or "snapshot" of anything. `trip_members`
gained columns over time (e.g., `playing_handicap`), but every such
addition in this project's migration history follows the same pattern:
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... DEFAULT ...` — every
pre-existing row automatically receives the new column with its safe
default the instant the migration runs. This is not a "these 20 rows
are old and different" situation; it's exactly how a relational schema
is supposed to evolve. Confirmed by reading the actual column
definitions, not assumed.

### 2. trip_groups — already created (5 groups, per your screenshot), and confirmed schema-stable

Your screenshot shows "Ready to Start · 20 players · 5 groups · 2
rounds" — **group creation has already happened for this trip.**
Traced `trip_groups`'s full schema history (migrations 009 through
015, the last one explicitly named "definitive"): `id, trip_id, name,
tee_time, sort_order, created_at`. No column has been added or changed
since. Whatever code created these 5 groups — whether last week or
today — wrote into the exact same table shape that exists now. There
is nothing "legacy" a pre-existing `trip_groups` row could contain.

**One specific thing I checked because it's directly relevant to
today's fix:** the group-naming race-condition fix I shipped this
round only changes what happens the *next time* a new group is
created (the server now derives the default name from a race-free
value instead of trusting the client's count). It does not touch, read,
or re-validate any *already-existing* group row. If Darren's 5 groups
already have distinct names, they'll stay exactly as they are; if
you ever add a 6th group from here, that creation goes through the
now-fixed path automatically — no action needed on the existing 5.

### 3. Round scorecards, holes, round_markers — confirmed NOT yet created

This is the most important finding, and it's the reason your instinct
not to touch this trip is correct. Scorecards, holes, and marker
relationships only ever come into existence through specific,
identifiable live actions:

- **`scorecards`** — created by `begin_round()`, which only runs when
  someone presses "Start Scoring" for a specific round (or, for a
  single player, via the pre-round paper/shared-device toggle, which
  writes a minimal row ahead of time). Your trip's status is "Ready to
  Start," not "Live" — the round has not been started, so
  `begin_round()` has not run for it.
- **`round_markers`** (the directional "who is marking whom"
  relationship) — only ever created when a digital player actively
  chooses their playing partner from live scoring. This cannot exist
  before scoring has begun.
- **`holes`** — created in the same `begin_round()` call as
  scorecards, same reasoning.
- **`round_group_starting_holes`** (Shotgun's per-group starting hole)
  — same, only written during round setup/start, not at trip creation.

**None of these tables have anything to be "stale" — because nothing
in them exists yet for this trip.** The entire downstream chain your
brief lists — paper/shared-device designation, tee times/starting
holes, Finalize/Release, Begin Round, score entry, marker handling,
leaderboard, reconciliation, round completion — will run for the first
time *right now*, using whatever code is deployed at the moment Darren
actually does it. There is no "old version" of any of this data to be
stale, because it doesn't exist yet.

### 4. The one thing I genuinely cannot confirm from here

**Whether migration 069 (this morning's scoring_method fix) has
actually been applied to your live Supabase instance.** I authored
that migration in this same session, verified its SQL against the real
current `begin_round()` definition by direct diff, but I have no way
to confirm from this sandbox that it has actually been run against
production. This is the one genuine, specific gate — not a vague
"something might be stale" concern, but one named, checkable fact.

---

## Answering each specific item from your brief

**Identify data that's safe to continue using as-is:** the trip row,
all 20 `trip_members` rows, all 20 `profiles`, and the 5 existing
`trip_groups` rows. All plain relational data, no schema drift, no
embedded logic.

**Identify anything materialised/snapshotted at trip creation that
could contain legacy values:** nothing. Trip creation itself (the
`/api/trips` POST route) only ever writes `trips` and `trip_members`
rows in the shape described above — it does not call `begin_round()`,
does not create scorecards, and does not snapshot any scoring
configuration. The snapshot-style data this project *does* have
(`scorecards.playing_handicap`, the now-fixed `scoring_method`) is
only ever written at `begin_round()` time — which, again, hasn't
happened for this trip.

**Confirm all required migrations have been applied:** cannot be
confirmed from this sandbox — this is the specific, named gate above.
Latest migration in this codebase is `069_begin_round_carries_scoring_
method.sql`.

**Check existing records against current schema/assumptions:** done
above for `trip_groups`; `scorecards`/`round_markers`/`holes` don't
exist yet for this trip, so there's nothing to check them against.

**Determine whether round-player/scoring records already exist despite
the lobby appearance:** groups already exist (visible in the
screenshot itself, so this isn't hidden). Scorecards/holes/markers do
not — inferred from the "Ready to Start" status, which this codebase's
round lifecycle only reaches before `begin_round()` runs, and confirmed
architecturally: there's no other code path that would create them
earlier.

**Paper/shared-device scoring_method preservation through
begin_round():** will apply correctly to every player designated as
paper on this trip from this point forward, **conditional on migration
069 having actually been applied** — see the one gate above.

**Race-free Playing Group naming fix:** will apply to any new group
created on this trip from now on; irrelevant to the 5 already created,
which are unaffected either way.

**Multi-round round-selection/data-integrity fixes:** these operate on
rounds/scorecards data that doesn't exist yet for this trip's rounds —
they'll apply from the first round onward, same as any other trip.

**Player-led playing-partner/marker logic:** `round_markers` doesn't
exist yet for this trip — the current, directional, permissive model
(no auto-pairing) is the only version of this logic that exists in the
deployed code today; there's no "old model" left to accidentally use.

**Whether trip creation date/version locks it to older logic:** no —
confirmed by searching the entire codebase for any date-based or
version-flag branching in trip/round logic. **None exists.** Every
route and RPC in this app operates purely on the current state of the
data, not on when a row was first created.

---

## GO / NO-GO PRE-FLIGHT CHECKLIST

Run this before Darren releases Round 1:

**GO conditions (all must be true):**
- [ ] Confirm migration `069_begin_round_carries_scoring_method.sql`
      has been applied to production (the one genuine gate from this
      audit — check Supabase's migration history directly, or run a
      harmless `SELECT proname FROM pg_proc WHERE proname =
      'begin_round'` and confirm the function's argument comment
      mentions `scoring_method?` if you can inspect its source, or
      simply re-run the migration file again — every migration in this
      project is written to be idempotent).
- [ ] Confirm the trip's 5 existing groups have no accidental duplicate
      names (a quick visual check in the Groups tab — this predates
      today's fix and isn't something that fix can retroactively
      verify for you).
- [ ] Confirm every player who should be paper/shared-device is
      correctly toggled in `BeginRoundModal` *before* anyone presses
      "Start Scoring" — this remains the one manual step in the flow;
      today's fix makes it robust against being missed, but doesn't
      remove the step itself.
- [ ] Confirm every player has a playing handicap set (existing
      validation already blocks Start Scoring otherwise — not new to
      this audit, just worth re-confirming for 20 players).

**NO-GO / stop and investigate further if:**
- [ ] Migration 069 is confirmed *not* applied — apply it first, then
      re-check this list; do not start scoring without it if any
      player will be paper/shared-device.
- [ ] Any group shows a genuinely duplicate name.
- [ ] Anything looks inconsistent between the Group Setup screen and
      what `trip_groups`/`trip_members.group_id` actually contain —
      would indicate something this audit didn't anticipate, worth a
      fresh, targeted investigation rather than proceeding.

**Do not recreate this trip.** Nothing in this audit found a technical
reason to. The 20 memberships, the trip itself, and the 5 existing
groups are all safe, current-schema, unmodified-by-this-audit data.

---

## On the separate production smoke test

Building a disposable 4–6 player test event and running the full
Darren workflow (groups → paper player → finalise → start → scoring →
leaderboard → finish round → Round 2) end-to-end on production is the
right complement to this audit, not a replacement for it — a static
code trace can tell you the architecture is sound and nothing is
locked to old logic; only an actual run against the live, deployed
stack can prove the whole chain works together right now. I'd
recommend running that smoke test — and specifically confirming
migration 069's effect within it (mark the test's paper player, start
scoring, confirm their card appears on the digital player's screen
immediately) — as the practical way to close the one gap this audit
couldn't verify directly.
