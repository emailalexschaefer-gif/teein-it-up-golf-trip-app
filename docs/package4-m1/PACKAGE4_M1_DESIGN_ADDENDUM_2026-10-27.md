# Package 4 - M1 Design Addendum (security-reviewed)
27 Oct 2026 · Status: **design only - nothing applied, run in production, deployed or merged. No ZIP.**
Supersedes the earlier M1 proposal wherever they differ. Files: `PROPOSED_104_competition_teams.sql` (v2), `scratch_test_m1.sql` (v2), `READONLY_m1_preflight.sql`, `READONLY_nine_hole_query_2.sql`.

## 0. Headline
1. **Your security gate was right.** The first draft trusted `p_actor` and `p_actor_is_organiser` from the caller. v2 removes both. Every write function derives the caller from `auth.uid()` and the caller's authority from the database (`is_trip_organiser()` for that round's event, nominated scorer, roster). Nothing about identity or privilege is accepted as an argument.
2. **New finding that affects every format, not just Ambrose:** Golf Australia's published Daily Handicap formula is `((GA Handicap x Slope / 113) + (Scratch Rating - Par)) x 0.93`. The app's `calculateDailyHandicap` is documented in code as an MVP formula `GA x Slope / 113` and deliberately omits the Scratch-minus-Par and 0.93 terms. I changed nothing. See section 7 - this needs your decision before any net team result is enabled.
3. Still true: all testing is in a scratch Postgres with stubbed prerequisites. Nothing is Supabase-verified, device-verified or live-verified.

## 1. Security and RLS verification
**Design (v2)**
- Seven write functions plus one read function, all `auth.uid()`-based, `SET search_path = pg_catalog, public, pg_temp`. `EXECUTE` revoked from PUBLIC, `anon` and `service_role`; granted to `authenticated` only. A call with no JWT returns `not_authenticated`.
- Authority is checked **before** anything is revealed, including idempotent replays (an outsider replaying someone else's `client_id` learns nothing).
- The API must call these with the **signed-in user's own Supabase client**, not the service-role client (the existing admin-RPC pattern would give `auth.uid()` = null and be refused - by design).
- Tables: RLS read-only policies; `INSERT/UPDATE/DELETE/TRUNCATE` also revoked from `anon` and `authenticated` as defence in depth. Revision history and the audit log are organiser-read only; flags are readable by the entry's roster and the organiser.
- Revision history is edit-proof by trigger (UPDATE blocked even for the table owner); DELETE is allowed only so a trip/round deletion cascades.

**Scratch evidence (66 checks, 0 failures)** - run as the real database roles: anon and service_role refused (42501); no-identity refused; no function has an actor/organiser argument (catalog check); every definer function pins search_path (catalog check); cross-event organiser refused for write, override, assign, unlock and flag; outsider and non-roster member refused; unconfirmed scorer refused; direct INSERT/UPDATE by an organiser or member refused; mate cannot read history or audit; outsider and other-event organiser read zero rows; cascade leaves nothing behind. Re-applying the file is idempotent.

**Finding in existing code (not changed):** `is_trip_member()` / `is_trip_organiser()` are `SECURITY DEFINER` and do **not** pin `search_path`. My new functions depend on them. Recommendation: pin it in a small, separate, reviewed migration (never by editing a shipped one). `READONLY_m1_preflight.sql` shows whether production matches.

**Not verified (remaining gate):** real Supabase JWT/PostgREST behaviour, Supabase default grants and default function privileges, the actual production schema. The preflight query checks these read-only.

## 2. Final score-conflict API contract
All routes: authenticate the user; 401 on no session; call the DB function with the user's client; map outcome to HTTP. Outcome is the source of truth.
| Route | Function | Success outcomes |
|---|---|---|
| `POST /api/team-scores` `{clientId, entryId, holeId, grossScore\|null, isNoReturn, drivePlayerId?, baseRevision, reason?}` | `submit_team_score` | inserted, updated, duplicate (all 200) |
| `POST /api/team-scores/flag` `{entryId, holeId, note?}` | `raise_team_score_flag` | flagged |
| `POST /api/team-scores/flag/resolve` (organiser) | `resolve_team_score_flag` | closed |
| `POST /api/team-entries/scorer` (organiser) | `assign_team_scorer` | assigned |
| `POST /api/team-scores/unlock` (organiser) | `release_team_override_lock` | released |
| `POST /api/team-scores/resolve-no-return` (organiser) | `resolve_team_no_return` | resolved |
| `POST /api/team-entries/waive-drive` (organiser) | `waive_team_drive_requirement` | waived |
| `GET .../completion` | `team_entry_completion` | completion JSON |

Refusal outcomes: `conflict` (carries the server revision/value), `locked`, `not_authorised`, `scorer_not_confirmed`, `round_closed`, `entry_withdrawn`, `reason_required`, `invalid_base`, `invalid_value`, `invalid_hole`, `invalid_drive_player`, `invalid_scorer`, `not_found`, `not_authenticated`, `not_locked`, `not_no_return`, `already_closed`. `conflict` and `locked` are not errors to retry: they stop the queue item and show the server value.

**Rules (all in the function, all tested):** each accepted write increments `revision`; same `client_id` is idempotent; `baseRevision` must equal the current revision (stale + identical value = duplicate, stale + different = conflict); a row lock serialises writers; organiser overrides need a reason and the organiser's own base revision; cancelled rounds accept nothing; closed rounds accept organiser corrections only.
**Race test (new functions, 8 simultaneous sessions x 18 holes, run as the `authenticated` role):** first write: exactly 1 inserted per hole (18 inserted / 98 conflict / 28 duplicate); edit at base 1: exactly 1 updated per hole (18 / 94 / 32); all 18 holes ended at revision 2 with 2 history rows. Local sessions on one Postgres, not a real network or Supabase.

## 3. No Return and organiser resolution
- A pick-up is stored as **No Return** (`is_no_return`, no score). No par-plus-X is invented and no other hole is touched.
- States per hole: **NR unresolved** (`nr_treatment` null) → organiser either (a) records **"no score"** via `resolve_team_no_return` (reason required, revision advanced, audited), or (b) enters an explicit capped/other score as a normal reasoned override. Any scorer rewrite of the hole clears the treatment.
- An unresolved NR blocks completion and therefore any official net placing. The engine (M2) must show the team as "Unresolved - organiser decision needed" and never rank it silently. What "no score" means for the ranking (e.g. unranked vs penalty) is an event-condition decision - see blockers.

## 4. Scorer assignment, override lock, reassignment
- `nominated_scorer_id` may be pre-suggested (first roster member) in the UI, but nothing scores until the organiser runs `assign_team_scorer` (sets `scorer_confirmed_at`; scorer must be on the roster; audited with from/to).
- After an organiser override the scorer is locked out of that hole. `release_team_override_lock` (organiser, reason required, audited) unlocks it **and advances the revision**, so anything queued earlier conflicts instead of overwriting the correction (tested: R5 conflict, R6 re-read edit succeeds).
- Reassignment: the previous scorer's queued submissions are refused `not_authorised`; the new scorer works from the current server revision (tested A1-A3). Superseded offline submissions cannot be reopened.

## 5. Completion rule
`team_entry_completion` returns: required holes, missing holes, unresolved No Returns, open flags, drive-shortfall players, and `complete`. Complete = every hole has a score row, no unresolved NR, no open flag, and the drive requirement is met or has been waived by the organiser (audited). Round close never converts an incomplete entry into a result. Nine and eighteen hole rounds both work (hole count comes from the round's holes), but nine-hole Ambrose stays blocked (section 8).

## 6. Optional drive tracking UX
- Setting: `min_drives_per_player` on the round config (NULL = off). Off = no extra step per hole, no extra queue field.
- On: after the gross score, a single row of roster chips "Whose drive?" (one tap, remembered default = last used, optional per hole). A compact progress strip "Drives: Sam 3/4 · Lee 4/4 …" with a clear shortfall state. Required hole-by-hole selection is not forced; the shortfall shows at completion for the organiser to waive or fix.
- No automatic penalties anywhere. Waiver is a reasoned, audited organiser action.

## 7. Ambrose handicap options - what is verified and what is not
**Evidence (read this session):**
- [Golf Select format page](https://golfselect.com.au/armchair/format?fid=1): 2 players: combined ÷ 4; 4 players: combined ÷ 8; 3 players: ÷ 6. States no rounding rule and does not say whether Daily or playing handicaps are used.
- [Australian Golf Digest](https://www.australiangolfdigest.com.au/a-score-to-settle/): traditional Australian method ⅛ combined (4), ⅙ (3), ¼ (2); USGA/WHS 2-player 35/15 (retained); WHS 4-player 25/20/15/10; no WHS 3-player method; **no rounding guidance**; quotes Golf Australia saying it follows global consistency rather than an Australian version.
- You cited MiClub documentation for ¼/⅛. I did not retrieve that page this session, so I am not relying on it.
- **No primary Golf Australia regulation on Ambrose allowances or rounding was found.** Do not describe any option as a Golf Australia requirement.

**Options (not activated):**
| | Two-player | Four-player | Example (2p: 8, 16 · 4p: 6, 12, 18, 24) |
|---|---|---|---|
| A Club divisor | combined ÷ 4 | combined ÷ 8 | 2p 6.0 · 4p 7.5 |
| B Weighted | 35% lowest + 15% highest | 25/20/15/10 lowest→highest | 2p 5.2 · 4p 9.0 |
| C Organiser-entered | typed per team, audited | same | - |
Rounding recommendation (for your approval, **not** verified): store the team handicap to one decimal, as the sources display it; apply it unrounded to the gross; show net to one decimal; ties by agreed countback. A whole-number option can be an explicit organiser setting. Plus handicaps enter as negatives. Complete two- and four-person teams only; incomplete teams are blocked from net results. Different tees and three-player teams are out of V8. The method, inputs, each player's handicap and the result are snapshotted per entry (`team_handicap_record`) and shown to players.
**Open question before enabling net:** which player handicap feeds the sum. The app today feeds Playing/Daily Handicap built from the MVP formula `GA x Slope / 113` (no Scratch-minus-Par, no 0.93; code comments call the slope step not yet wired into the live flow, so many events may be using the raw handicap). GA's published Daily Handicap is `((GA x Slope / 113) + (Scratch - Par)) x 0.93` ([GA help](https://help.golf.com.au/support/solutions/articles/51000432858-whs-understanding-daily-handicaps) - quoted from a page fetch, please confirm the wording and effective date yourself; it states no rounding rule and no effective-from date). This is a **separate impact report item**; it affects Stableford too and I have changed nothing.

## 8. Nine-hole limitations
- [GA help, 9-hole Daily Handicaps](https://help.golf.com.au/support/solutions/articles/51000432854-whs-understanding-9-hole-daily-handicaps): `((GA x Slope / 113) + ((Scratch - Par) x 2)) x 0.93`; strokes applied using the 9-hole course indexes; first-card instruction uses 27. Not stated: rounding, effective date, and exactly how the stroke indexes map. Treat as a lead to confirm, not a spec.
- Code trace (earlier): the Stableford DB trigger allocates strokes as 18-hole; the TS helpers support `holesInRound`; no nine-hole handicap conversion exists. Whether production nine-hole rounds are affected is **unconfirmed** - waiting on `READONLY_nine_hole_query_2.sql` (and the earlier query). No retroactive recalculation, no trigger change, no historical edit; a separate impact report comes before any proposal.
- **Nine-hole Ambrose: blocked.**

## 9. Migration readiness and dependencies
- Number 104 is free in the repo (latest is 103). Production state is unseen: run `READONLY_m1_preflight.sql` and send the grid.
- Depends on: `profiles, trips, trip_members, trip_groups, rounds, holes, is_trip_member(), is_trip_organiser()`; `rounds.status` allows upcoming/active/completed/cancelled (used by the function).
- Additive only; no existing table, trigger, policy or function is altered; round-number storage is not included. Rollback drops the new objects in order (listed in the SQL).
- **Not yet in the file (M2):** organiser setup functions (create team, build entry/roster, round config, handicap snapshot) - same `auth.uid()` + `is_trip_organiser()` pattern. I will not finalise the migration until these and the handicap design are approved, so the migration lands as one reviewed file.

## 10. Remaining blockers needing your approval
1. **Daily Handicap formula**: keep the MVP formula or adopt GA's published formula (impact report first; separate from M2).
2. Ambrose method defaults, source-checked against a primary GA/club document; rounding rule.
3. What a resolved "no score" No Return means for ranking (unranked vs conditions-based penalty).
4. Pin `search_path` on the two existing helpers (separate migration).
5. Run the preflight and both nine-hole read-only queries.
6. Approve the API calling convention: user-scoped client for all team-score routes.

## 11. Test status
Scratch DB only: 66 behaviour/security checks, 0 failures; idempotent re-apply; concurrency 8 x 18 holes (both phases) one winner per hole. App-level tests still 1609/1609 in the p4 tree (no app code changed in M1). **Not done:** Supabase verification, device testing, live-database testing, the 40/100-player fixtures (M2).
