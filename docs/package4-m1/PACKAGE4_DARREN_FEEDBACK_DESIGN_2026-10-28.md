# Package 4 - Design response to Darren's field feedback
28 Oct 2026 · **Design only. No code written, no SQL changed or run, nothing deployed.** The proposed migration 104 file is unchanged; section 6 lists the exact edits I would make on approval.

## 0. Summary
- **Team Stableford is feasible without touching the Stableford trigger.** Both Ambrose modes read the same stored data (one gross team score per hole). Only the *derivation* differs, so the M1 score tables, revision/conflict model, security functions and offline queue need **no change**.
- Net Stroke needs only the team handicap. **Team Stableford additionally needs a whole-number stroke count, hole par and stroke index**, so it adds one decision (rounding to whole strokes) and makes nine-hole harder than Net Stroke.
- Singles and four-ball Ryder Cup matches can be derived from the **existing individual scorecards**; only foursomes needs the team engine.
- "Slot" order is **not stored anywhere today** (`round_arrangements` has player, group, no position). That is fine for the design below, which keeps slot order as a setup-screen convenience only.

## 1. Revised Ambrose scoring-mode design
`round_competition_config` gains `scoring_mode`: `net_stroke` | `team_stableford`. Chosen at setup, frozen once scoring starts (the existing freeze rule). The gross entries, revisions, locks, flags, drive tracking and completion rule are identical in both modes.

| | Net Stroke | Team Stableford |
|---|---|---|
| Needs | gross total, team handicap (1 dp) | per-hole gross, hole par and stroke index, **whole-number strokes received** |
| Result | net = gross total − team handicap, lowest wins | sum of per-hole points, highest wins |
| Ties | shared rank (countback undecided) | shared rank (countback undecided) |
| Computed where | TypeScript, on read | TypeScript, on read, using the pure `calculateStableford` / `getHandicapStrokesForHole` helpers |
| Writes to `stableford_pts` / `score_entries` | never | **never** (24 files read `stableford_pts`; team results must not appear there) |

Team results are derived on read; nothing team-related is written to individual Stableford tables, and a structural test will forbid it (extension of the existing M2 guard). Powerplay (an individual feature) does not apply.

**Pick-up in Team Stableford.** In ordinary Stableford a pick-up scores 0 points. Your approved rule is that an unresolved No Return blocks an official placing. These conflict for this mode. Options: (a) keep the approved rule (organiser resolves every NR); (b) add an organiser-resolution value `zero_points` for Team Stableford only, so a pick-up can be confirmed as 0 points under the event conditions without inventing a gross score. I recommend (b), organiser-confirmed per hole, never automatic. **Decision D1.**

## 2. Team handicap allocation for Team Stableford (proposal)
Facts from running the existing pure functions (nothing changed):
- `getHandicapStrokesForHole` **silently accepts a decimal**: handicap 7.5 behaves as 7 (strokes on SI 1-7). Team handicaps are stored to one decimal, so team code must never pass them in directly - a deliberate whole-number step is required.
- 9-hole use requires stroke indexes 1-9; the helper throws for SI 11 with `holesInRound = 9`.

Proposal:
1. Team handicap stays at one decimal (as approved) and is shown as such, including for Team Stableford.
2. **Strokes received** = team handicap rounded **once** to a whole number, half up (the project's existing handicap rounding direction), stored in the handicap snapshot as `strokesReceived` so the number is explicit and auditable.
3. Strokes are placed hole by hole by stroke index with the existing, tested allocation (handicap above 18 gives second strokes; plus handicaps give strokes back).
4. Points per hole = `max(0, 2 + par − (gross − strokes))`, unchanged from the standard table you listed.

Worked example (18 holes, par 72, gross 75; team 6, 12, 18, 24 with the club divisor = 7.5):
| Strokes used | Team Stableford total |
|---|---|
| 7 (round down) | 40 |
| **8 (7.5 half up)** | **41** |
| 9 | 42 |
Net Stroke for the same card: 75 − 7.5 = **67.5**. The rounding choice at an exact .5 moves a team by one point, so it must be an explicit approved rule (**D2**). The method-C organiser-entered handicap can be a whole number and avoids the question.

## 3. Does Team Stableford change the approved handicap and nine-hole design?
Yes, in two ways. (1) The handicap snapshot gains `strokesReceived`. (2) Nine-hole Team Stableford needs a nine-hole team handicap **and** nine-hole stroke-index allocation, so it depends on the unresolved nine-hole contract more than Net Stroke does. Both nine-hole modes stay blocked. The Daily Handicap decision affects both modes equally (it changes the player inputs).

## 4. Slot-based team assignment
- **Explicit records only.** Suggestions come from a pure function over the group's player order and are shown for review; "Save" calls the existing `save_round_team_entry`, which stores real roster rows. Re-ordering a group later never changes a saved team, and scores never move (roster edits are already refused once that team has a score).
- **Slot order** = the order the organiser sees the group's players in at setup (draggable). It is a UI input, not stored data, so **no schema change**.
- Defaults: two-person Ambrose and (later) Alternate Shot: slots 1+2 = Team A, 3+4 = Team B; four-person Ambrose: all four = one team. Groups that are not a multiple of the team size (3 or 5 players) leave the extra players flagged **Unassigned** and block "Confirm/release" until the organiser fixes it. No auto-fill with guesses.
- Display: team shade **plus** a text label ("Team A") and an icon/pattern, never colour alone; shades chosen for contrast on the existing dark and light themes. `competition_teams.colour` already exists.
- Boundary: the roster is editable until the first team score is recorded (database-enforced). I propose the organiser setup step also locks at round **release** except through an explicit audited "reopen setup" action (**D3**).
- Organiser flow stays: select format → scoring mode → handicap method → add players to groups → suggested teams → review/confirm scorer → release → score → close. No extra stages; teams and scorer sit on one review screen.
- Physical group, event team and round roster stay three separate things (as built).

## 5. Alternate Shot / Foursomes - compatibility
- **Reuses unchanged:** `team_score_entries`, revisions, nominated scorer, flags, organiser override/unlock, offline queue, completion rule, results adapters.
- **Different:** no drive selection (the tee-off alternates by rule), so `min_drives_per_player` must be refused for this format; copy and UX must say "alternate shots with one ball"; weighted scramble allowances do **not** apply (they are scramble allowances) - Darren's combined ÷ 2 and organiser-entered are the methods; any official Foursomes allowance for stroke play and for match play must be verified from a primary source (I have not verified one and make no claim).
- **Code:** `handicap.ts` is currently keyed on `ambrose` and team size; it would be generalised to a team-format dimension when Alternate Shot is built. Registry gets `alternate_shot` as `planned`; **not selectable** in V8.
- **Schema:** `format`/`handicap_method` CHECK constraints in `round_competition_config` would need extending. Because 104 is unapplied I could add them now, but that is a speculative migration, so I recommend **not** adding them until Alternate Shot is approved; a small additive migration can relax the two constraints then.

## 6. Ryder Cup match-scoring proposal
**Three separate layers** (so Stableford points never leak into the tally):
1. *Round scoring mode* (Stableford, stroke, Ambrose...) - what each player/team scored.
2. *Match result* - which side won or halved a specific match.
3. *Event standings* - sum of match points per side. Default win 1, half 0.5, loss 0, **configurable per match** (e.g. a foursomes session weighted differently).

**Reuse:** `src/lib/scoring/ryderCup.types.ts` already defines red/blue, outcomes and the 1 / 0.5 / 0 points plus a tested `sumRyderCupPoints`. It is unwired, with no tables. It lacks the match *basis*, concessions and side/team distinction, so I would extend it, not duplicate it.

**Match basis** (the question for Darren): `hole_by_hole` (traditional match play, "2 & 1"), `stableford_total` (higher team/player total wins, equal halves), `net_stroke_total` (lower net wins, equal halves). Different rules, different data. I recommend supporting `hole_by_hole` for singles and four-ball first (your approved initial scope) and the two totals bases as the cheap second step.

**Data source:** singles and four-ball better-ball derive from the individual scorecards already captured (self/marker model); no team engine needed. Foursomes (and Ambrose-vs-Ambrose) uses the team engine. So V8 Ambrose does not block Ryder Cup singles/four-ball.

**Rules to settle before building:**
- Match handicap allowances (singles difference, four-ball percentage, foursomes) - **unverified here, need a primary source**.
- Hole-by-hole: net score per hole after allowance; closes out when the lead exceeds holes remaining; all square after the last hole = halved.
- Concessions: an explicit state "hole conceded" / "match conceded", recorded by the scorer or organiser with audit, never a fake score.
- Incomplete matches at round close: I will not choose a default. Options: halved, awarded on current standing, void. Until the organiser decides the match shows "Incomplete" and contributes no points (**D6**).
- Players in a match must be in the round's roster and on opposite sides; one player in one match per session.
- Official match result stored with organiser override and audit; live "x up thru n" derived.

**Schema (later migration, not 104):** `competition_sides` (red/blue per event) with a side reference on teams, `ryder_matches` (round, kind, basis, points win/half), participant rows, concession rows, stored result + override audit. None of this is needed for V8.

## 7. Impact on migration 104 and the security-reviewed schema
Exact edits on approval (all in the unapplied proposal; no change to the security model, privileges or function authority):
1. `round_competition_config.scoring_mode TEXT NOT NULL CHECK (scoring_mode IN ('net_stroke','team_stableford'))`.
2. `configure_round_competition` gains `p_scoring_mode` (validated); `lock_team_handicap` requires an integer `strokesReceived` in the record when the mode is `team_stableford`.
3. If D1 option (b): `nr_treatment` CHECK also allows `'zero_points'`, and `resolve_team_no_return` accepts a treatment argument (still organiser-only, reasoned, audited, revision-advancing).
4. Tests added for the above; the existing 112 scratch checks re-run.
Unchanged: `team_score_entries`, revisions, `submit_team_score`, `assign_team_scorer`, unlock, flags, RLS, grants, completion function.
TypeScript (isolated tree): a pure `teamStableford.ts`, a `stableford` basis in the leaderboard (highest first, NR/`zero_points` handled), an integer-strokes step that refuses decimals, and new guards (team code must not touch `stableford_pts` or `score_entries`; no decimal handicap reaches the stroke allocator).

## 8. Decisions needed before M2 coding
- **D1** Pick-up in Team Stableford: keep unresolved-NR-blocks-placing only, or add organiser-confirmed `zero_points` (recommended).
- **D2** Team Stableford strokes: round the one-decimal team handicap half up to whole strokes (recommended), or round down, or organiser-set whole number only.
- **D3** Setup lock: at first score only, or at round release with an audited reopen (recommended).
- **D4** Countback/tie-break for equal team totals in both modes (currently shared rank).
- **D5** Confirm Alternate Shot stays out of V8 and its constraint changes wait for approval.
- **D6** Ryder Cup: Darren's answer on match basis, plus unfinished-match treatment, concession handling and match handicap allowances (primary-source check).
- **D7** Whether the combined ÷ 2 Alternate Shot method needs a primary-source check before it is offered (I have not verified it).
- The earlier open items stand: Daily Handicap rule, Ambrose allowance text from Golf Australia, Supabase integration test, the read-only query results.

## 9. Question for Darren
> When a Ryder Cup match is Stableford or stroke, is the winner decided by comparing the two sides' **total** Stableford points / net strokes for the round, or by traditional **hole-by-hole** match play (holes won, "3 & 2")? And if a match is unfinished or a hole is conceded, what should the result be?
