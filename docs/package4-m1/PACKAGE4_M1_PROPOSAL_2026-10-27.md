# Package 4 - M1 Proposal: Competition Teams & Score-Conflict Design
Date 2026-10-27 · Status: **FOR APPROVAL - nothing applied, nothing deployed, no production change**

## 1. What was and was not done
- Done (sandbox only): proposed migration `PROPOSED_104_competition_teams.sql` applied to a **scratch Postgres 16** with stubbed prerequisites; 20 scenario tests (`scratch_test_m1.sql`) pass; re-apply is idempotent; history rows are edit-proof; deleting a team entry cascades cleanly.
- Concurrency test (scratch DB): 8 simultaneous sessions x 18 holes, first write at base 0: exactly 1 `inserted` per hole (18 inserted / 94 conflict / 32 duplicate). Then 8 simultaneous edits at base 1: exactly 1 `updated` per hole (18 / 93 conflict / 33 duplicate); all 18 holes ended at revision 2 with 2 history rows. No lost update was observed. (Separate local sessions on one Postgres - not Supabase, not a real network.)
- NOT done: no real/production database touched, no migration run, no app code for the team engine, **no device testing**, no live-DB verification. Migration number 104 is a placeholder; confirm against the migrations folder before any real use.

## 2. Schema (migration 104 proposal, additive only)
| Table | Role |
|---|---|
| `competition_teams` | Event-level team identity (trip_id, name). Persistent across rounds. |
| `round_competition_config` | Per-round format config: format, handicap method (A/B/C), allowance snapshot, points rules. |
| `round_team_entries` | Round-level entry = roster snapshot + `nominated_scorer_id`, status (active/withdrawn), team handicap snapshot. |
| `round_team_members` | Members of an entry (profile/trip member). Playing groups are separate and unrelated. |
| `team_score_entries` | One row per entry+hole: gross, no_return, drive_player_id, `revision`, `admin_overridden`, client_id. |
| `team_score_revisions` | Append-only history of every accepted write (UPDATE blocked by trigger; DELETE allowed so cascades work). |
| `team_score_flags` | Member dispute flags (entry, hole, raised_by, note, status open/resolved). |

No existing table is altered. Stableford/individual tables, `stableford_pts`, the trigger and V6/V7 behaviour are untouched. Identity is event-level, roster snapshot is round-level, so there is one source of truth for each.

## 3. Score-conflict contract: `submit_team_score(...)`
Arguments: client_id, entry_id, hole_id, gross (nullable), no_return, drive player, **base_revision**, actor, actor_is_organiser, reason.
Outcomes: inserted, updated, duplicate, conflict, locked, invalid_base, not_authorised, round_closed, entry_withdrawn, reason_required, invalid_drive_player, invalid_hole, invalid_value, not_found.
Rules (all tested):
1. Same `client_id` replay returns the original result (idempotent - safe offline retry).
2. Only the nominated scorer writes; the organiser may write only with a reason (audit).
3. `base_revision` must equal current revision. Stale base + identical values = `duplicate`; otherwise `conflict` returning the server value.
4. Row lock serialises concurrent writers (the reason the race test gives exactly one winner).
5. After an organiser override the scorer is locked (`locked`) until decision 4 below.
6. Scorers cannot write after the round closes; the organiser can, with a reason.
7. Every accepted write appends a revision row.

This replaces "latest entered_at wins" (adequate for individual scores, **not** for a shared team score).

## 4. RLS / authorisation
- Direct client writes disabled on all new tables; reads via RLS: trip members read teams, entries, members, scores; revision history organiser-only; flags visible to entry members + organiser.
- Writes only through SECURITY DEFINER functions invoked from API routes that have already authenticated the user (`actor` supplied server-side, never from the client body).
- Flag creation: any member of the entry. Scorer assignment and override: organiser only.

## 5. API contracts (to be built in M2, not now)
- `POST /api/team-scores` `{clientId, entryId, holeId, grossScore|null, isNoReturn, drivePlayerId?, baseRevision}` → `{outcome, revision, serverValue?}`
- `POST /api/team-scores/flag` `{entryId, holeId, note}`
- `POST /api/team-scores/override` (organiser) `{entryId, holeId, gross, reason}`
- `POST /api/team-entries/scorer` (organiser) `{entryId, scorerId}`
- 401 handling reuses V7 `isAuthFailure`/haltPass rules: signed-out only when authentication is established; unrecoverable server errors stay visible and diagnosable.

## 6. Offline queue
Separate Dexie `teamScoreQueue` (the individual `scoreQueue` is not modified, so V6/V7 behaviour is preserved). Each item stores `baseRevision`; chained offline edits to the same hole keep the **original** base revision. `conflict` shows the server value and asks the scorer to accept or re-enter. Transport/auth rules reuse V7 logic.

## 7. Ambrose handicap design (methods A/B/C)
- **A club divisor**: 2p team = sum ÷ 4; 4p = sum ÷ 8. **B weighted**: 2p 35% lower + 15% higher; 4p 25/20/15/10 lowest→highest. **C organiser-entered**.
- Net = team gross − team handicap. Method and inputs are snapshotted on the round config and shown transparently.
- Caveat: these were verified only from **secondary sources** (Australian Golf Digest, GolfSelect); no primary Golf Australia regulation was found and **rounding is unspecified**. Per your rule, no method is activated by default until you verify against the GA regulations.
- Three-player teams: club divisor ÷6 (secondary source); weighted has no standard three-player method → organiser-entered. Different tees: unsupported initially. Plus handicaps handled as negative values in the sum.
- **Nine-hole Ambrose: blocked** until the nine-hole contract (below) is settled.

## 8. Nine-hole issue (kept open)
Code trace: the DB trigger (migrations 019/037/052/055) always allocates strokes as an 18-hole round; the TS helpers support `holesInRound` but the Daily Handicap is not converted for nine holes. An inconsistency is **likely but unconfirmed**. I have not seen production data. Please run the two read-only queries (`READONLY_nine_hole_query_2.sql` plus the earlier one) and send results. Proposed principle (for later approval): an appropriate nine-hole handicap and allocation, no blind halving, **no retroactive recalculation and no Stableford trigger change** without separate approval; golden tests preserve V7 results.

## 9. Side-game compatibility (initial)
Skins (My HQ → Side Games): playing-group scope first, derived from official scores, no wagering; compatible with individual Stableford; for Ambrose, team-score skins deferred. Ryder Cup: singles + four-ball first, foursomes later; points win 1 / half 0.5 / loss 0.

## 10. Migration plan
Additive, new tables/functions only; preflight (confirm helper functions `is_trip_member` etc. exist, number free) and postflight (object counts, policy list) checks; rollback = drop new objects in reverse order (no existing data affected). Applied only after your explicit approval, never by me.

## 11. Acceptance tests / fixtures
Existing: 20 scenarios + race test above. To build in M2: 20-player Stableford (regression), 40-player charity Ambrose (10 foursomes), 100-player corporate Ambrose (25 teams, offline replay), multi-round Ryder Cup. Golden Stableford cases already pass (suite 1609/1609 in the p4 tree). These are sandbox tests; device and live checks remain yours.

## 12. Decisions needed from you
1. Picked-up hole in Ambrose: count as no-return (excluded), or net double bogey/par+X cap? 
2. Scorer assignment: organiser assigns; default first member - OK?
3. After an organiser override, may the organiser release the scorer lock?
4. Team round completion: all 18 holes scored by the scorer, or organiser-closed?
5. Confirm nine-hole Ambrose stays blocked until the nine-hole contract is approved.
6. Who verifies the GA Ambrose allowances and rounding (primary source)?
7. Support 3-player teams in v1?
8. Track drive usage (per-hole drive player) in v1 or defer?

Approve M1 (with answers) → I proceed to M2 (engine, APIs, queue). Until then no implementation.
