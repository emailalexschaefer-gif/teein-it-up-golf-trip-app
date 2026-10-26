# Package 2 — Final Corrections, Handicap Validation & Release Approval Gates
26 October 2026 · Baseline: Package 2 on latest Package 1 · **Not deployed. No migration executed. Package 3 / migration 100 not merged.**

## 1. Handicap validation audit
| Layer | What exists | Range rule | Plus handicaps |
|---|---|---|---|
| Profile `profiles.handicap` DECIMAL(4,1) | no DB CHECK | **UI input `min=0 max=54`** (ProfileForm) | storable in DB, **blocked by the form** |
| Event member `trip_members.playing_handicap` NUMERIC(4,1) | CHECK −10..54 (mig. 013/015) | join prompt −10..54 | supported (+10 plus down to −10) |
| Round override / released value | **was** my −10..60 (withdrawn) → now none | whole number, 32-bit technical limit only | supported |
| `scorecards.playing_handicap` INTEGER | no CHECK | none | supported |
| Daily/Course Handicap = GA × slope ÷ 113 (`calculateDailyHandicap`) | rounds half-up, keeps sign | none | supported (−2 stays −2) |
| Stroke allocation `getHandicapStrokesForHole` + SQL `calculate_stableford_points` | floor + true modulo | none | **supported** |

**Changes made**
- Removed the −10..60 rule everywhere: migration 101 CHECK, API validation, constants, tests, report. The only guard left is "finite number within 32-bit INTEGER" (the type of the column it is stored in). Documented in `arrangements.ts`.
- Released handicaps use the existing `roundHandicap` (half-up) already used by the scoring path; whole numbers pass through untouched. Nothing is clamped or replaced.
- New display helper `formatGolfHandicap`: stored **−2 is shown as "+2"**, +4 → stored −4, scratch 0, 18, 36 unchanged. Applied to organiser setup (Begin Round), lobby roster, Starting Grid, Field list, player card, badges, scorecard headers (both shells), My Golf rows, completed results. Display only — the stored value never changes, scoring never reads the display string.

**Canonical scoring already supports plus handicaps — no engine change.** Proven by 8 TypeScript tests and a real-PostgreSQL test of `calculate_stableford_points`: plus-2 gives a stroke back on SI 17–18 only; plus-4 on SI 15–18; strokes always sum to the handicap (−15 … 74). A pars-only 18 holes scores 32 (+4), 34 (+2), 36 (0), 54 (18), 72 (36). A handicap of **+2 strokes received (value 2)** and **plus-2 (value −2)** produce different points, so the two cannot be confused.

**Handicap Index vs playing handicap:** profile/event values are the Handicap Index (GA). The round's playing (Daily) handicap = Index × slope ÷ 113, or the organiser's override. The release stores the *playing* handicap and Start Round writes exactly that to the scorecard (`released ?? resolved`; `??` keeps 0 and negatives).

**Issues for your decision (not changed — domain decisions)**
1. ~~Profile form `min=0`~~ **RESOLVED (approved):** profile input now accepts −10 to 54 (the existing event rule, shared constants `HANDICAP_ENTRY_MIN/MAX`), checks the same range in code on save, shows the hint "Plus handicap? Enter −2 for a +2 handicap.", and previews the value through `formatGolfHandicap`. Typed −2 is stored as −2. No scoring change, no data migration, existing values untouched.
2. **Existing event-handicap CHECK −10..54** is older than Package 2. It cannot hold a plus-11 or higher index; Course handicaps above 54 are fine at round level (released/scorecard have no cap). Not changed; no conflict with 101.
3. **Organiser stepper:** "−" lowers the stored number, so from scratch it shows "+1". That is correct golf notation but worth a look on a phone.
4. SQL Stableford allocates over 18 holes (as before) — unchanged.

## 2. Unpublished edits cannot leak
New `publishedView.ts`: for an **upcoming round that has been released**, every non-organiser read serves the snapshot:
group-tee-times, starting-holes, my-starting-hole, my-round (group name + playing partners), Starting Grid (`/arrangements`), the lobby group + tee-time row (shows nothing live until the snapshot answers), EventCountdown (`?published=1`). The organiser's editor deliberately still reads live drafts. Start Round compares live to snapshot and returns 409 `arrangements_changed` (edits are never discarded). Notification text is generated at release time from the snapshot diff. Shared-device and paper-player views run after Start (scorecards) and are unaffected; no draft read exists there. Tests: closing the editor leaves Group 2 / 18 / 9:30; the draft is detected as pending; completed/active/legacy rounds not affected.

## 3. Legacy released rounds (`setup_released = true`, no snapshot)
- Completed/active rounds: never touched, never converted, no recalculation.
- Start Round on a legacy upcoming round behaves exactly as before 101 (no snapshot → previous logic); nothing is rejected.
- **Conversion = one Confirm & Re-release.** It saves exactly what is set up now as version 1, starts nothing, and is **silent** (players already saw these arrangements) unless the organiser ticks "Also send the announcement". The modal explains this in plain words. Pressing it again with no changes sends nothing.
- Exact procedure: (1) apply & verify 101; (2) deploy; (3) run preflight check 91 to list upcoming released rounds; (4) for each, organiser opens Begin Round → reads the note → Confirm & Re-release; (5) preflight check 93 shows 0 remaining.

## 4. Read-only production preflight
`supabase/preflight/101_preflight.sql` (SELECT only). Checks 062, 025 (columns, message types, RLS), 097 (status CHECK, events table), 053/055, scorecards type, `begin_round`, 098/099 present/absent, 100 irrelevant, whether 101 is applied/partial, name collisions, no handicap CHECK on the snapshot, function not executable by anon/authenticated, upcoming released rounds / without snapshot, live handicap ranges. Verified on a scratch PostgreSQL both before and after 101 — **not run against your production database**.

## 5. Notification / release integrity (SQL, real PostgreSQL, 9 scenarios)
Organiser-only enforced inside the function and the API · event-scoped rows (cross-event refused, atomic) · one transaction: snapshot + log + messages together or nothing · stale/duplicate/racing requests rejected by revision · unchanged re-release sends nothing · re-release messages only to affected players · initial release = one announcement · plus (−4/−2) and 74 stored exactly · withdrawn player removed. Reconnecting players read the current snapshot. Organiser sees clear success/failure text.

## 6. Package 1 protection
Diff of the Package 1 final ZIP against this tree: **only Package 2 files differ; nothing removed**. Music, applause, confetti, photo/caption sync, Memories fix, navigation, optional fullscreen, public/private sharing, live leaderboard Share, My Golf history are byte-identical. Parked: Android fullscreen notice (browser-generated), celebration audio on Samsung/Android — still open. No migration 100.

## 7. Results
- Full suite: **1467 / 1467 pass** (was 1446; +21, including 4 profile-handicap tests). SQL: release suite 9/9, Stableford plus-handicap suite pass (both on PostgreSQL 16 scratch DB).
- TypeScript: transpile/syntax check of every changed file passes. **Full `tsc` type-check, `next lint` and `next build` could NOT be run:** the sandbox cannot reach the npm registry (tried `npm install` twice, including via the proxy). This is a gap, not a pass — run `npm ci && npx tsc --noEmit && npm run lint && npm run build` before deploying (Vercel preview build does the same).
- **Not verified:** the new/changed routes against live Supabase; the modal, lobby and Starting Grid rendered in a browser after these corrections; real phones.

## 8. Applying migration 101 (exact instructions — do only after approval)
1. Supabase dashboard → SQL Editor → New query. Paste all of `supabase/preflight/101_preflight.sql` → Run. Every row must be OK/INFO/WARN (WARN on check 91 just lists rounds to convert later). Any FAIL: stop and send it to me.
2. New query. Paste all of `supabase/migrations/101_round_arrangements_release.sql` → Run once. It is additive and idempotent (safe if re-run); it does not touch existing rows or migration 100.
3. Re-run the preflight. Required: check 74 = OK "5 of 5", 82 = OK, 83 = OK, 70–73 show present.
4. Only then deploy the app (deploying first shows organisers "migration missing" and releases nothing).
5. Convert upcoming released rounds (section 3), then phone test.
**Rollback:** redeploy the previous app release (older app ignores 101, which can stay). Full DB rollback (only if nothing was released with 101): `DROP FUNCTION release_round_arrangements(UUID,UUID,INTEGER,JSONB,JSONB,JSONB); DROP TABLE round_release_log; DROP TABLE round_arrangements; ALTER TABLE rounds DROP COLUMN release_revision, DROP COLUMN released_at;` — chat messages already sent remain.

## 9. Six-step phone acceptance checklist
1. **Organiser:** after Round 1, set Round 2 groups; give one golfer a plus handicap (stepper shows "+2"); Confirm & Release → "Released to Players (version 1)"; scoring still locked.
2. **Player phone:** Event Lobby shows group, partners, tee time, start hole and playing handicap (plus golfer sees "+2"); exactly one chat announcement.
3. **Organiser:** change a group/handicap, close without re-releasing. **Player:** refresh — still the original arrangement, no new message.
4. **Organiser:** press Start Round → blocked with "Confirm & Re-release" explanation. Then Confirm & Re-release.
5. **Players:** only affected players get a message and an "Updated" badge; unaffected players get nothing.
6. **Organiser:** Start Round → scorecards show the same handicaps as published (plus golfer gets a stroke back on the two easiest holes); Round 1 scores/handicaps unchanged. (Legacy released round, if any: one silent re-release first.)
