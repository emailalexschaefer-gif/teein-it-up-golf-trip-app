# Package 3 — Finish Round Early (delivery report, 2026-10-25)

**Status: built and sandbox-tested. NOT deployed. Migration 100 NOT applied. v3 NOT overwritten.** This is a separate release on top of v3 (097–099 + P1/P2/End Event).

## What it does
Three separate actions, never mixed up:
- **Cancel Round** – upcoming rounds only (unchanged).
- **Finish Round Early** – a round in play that cannot be completed (new). Organiser-only, My HQ → Stage 3 Close Round.
- **Close Round** – normal completion (unchanged; source-pinned by a test).

Finishing early never sets `cancelled`, never ends the event, never declares a champion, never touches canonical scores.

Dialog: reason (Weather/course conditions, Safety/emergency, Other) + note (200 chars), official result (shortened nine-hole / none), "Count this shortened round toward the event championship?" (**default No**), impact preview (players with a valid nine, incomplete players, per-player list, scores/Moments preserved, upcoming rounds untouched), mixed-nines warning with extra confirmation, statement that it does not end the event or crown anyone. Popup z-index 120, 88dvh, sticky buttons with safe-area padding.

## Rules implemented
- **Rule A:** finished-early round is excluded from the championship unless the organiser includes it (audited; changeable later via My HQ panel).
- **Rule B:** < 9 eligible holes ⇒ player is INCOMPLETE: every score/point kept, official points NULL (never 0), no fake zeros/pick-ups. A genuine nine of pick-ups is a real qualifying 0.
- **Official nine** (decided in SQL, one implementation): the first nine holes of the player's own playing sequence from their actual start hole (round start, or shotgun group start; wraps, e.g. start 14), every one with a self-captured score or pick-up. Not best-nine, scattered nines do not qualify. 11 holes ⇒ all 11 kept, only the first nine count officially.
- **Two-group ranking:** qualifying players ranked; incomplete players shown apart as "Not ranked — incomplete round" with real points. Applied to live board, final results, public link, PNG, PDF, Event Memories/presentation, event stories, setup context, leaders-last seeding, Event Champion highlight.
- **Mixed shotgun nines:** allowed, explicit warning + extra confirmation (enforced in the database too); no handicap formula.
- **Frozen results + audited manual refresh:** results are snapshotted at finish. If a score changes later the panel flags "Official results may be out of date" and offers organiser-only **Refresh Official Results** (atomic, audited, idempotent). Nothing recalculates silently. After the event has ended the panel reminds to republish the presentation.
- **Finish Event:** two outcomes — **Competition concluded** (stored exactly like a normal completion, champion from standings; only when no round is upcoming/cancelled, a round was finished early, and at least one round counts) and **Event ended early** (existing 099 flow, champion yes/no). No change to migration 099.
- Labels: "Round Finished Early — Weather", "Official 9-Hole Result", "Counts / Not Counted Toward Event Championship", "Not ranked — incomplete round".
- Public link shows only the reason category; the organiser's note and player ids never reach it (tested).
- Preserved for a future social handicap (frozen per-player snapshots incl. holes, per-hole points, playing handicap) independent of championship inclusion; no handicap engine added.

## Migration 100 (additive, idempotent; run order 097 → 098 → 099 → 100)
Round columns + consistency constraint; `round_official_results` (UNIQUE per round/player; CHECKs: qualifying ⇒ exactly nine distinct holes in 1–18, nine per-hole points summing to official points; incomplete ⇒ NULL official data); `round_early_finish_events` audit table; RLS on, no policies; functions `round_official_snapshot`, `official_snapshot_is_mixed`, `finish_round_early` (locks the round row; round + decisions + snapshots + audit in ONE transaction), `set_round_early_inclusion`, `refresh_round_official_results`; EXECUTE only for service_role. The app tolerates 100 being absent (every round reads as normal; Finish Round Early returns a clear 503 "database update pending").
**Rollback:** drop block in the migration header. Caution: after rollback a previously finished-early round reads as a normal completed round and **would count fully** toward the championship — switch inclusion decisions into account (or don't roll back after real use).

## Verification — what is and isn't proven
**Sandbox-verified**
- Full suite: **1,388 pass / 0 fail / 1 skipped** (baseline v3 was 1,351; +12 engine tests, +26 integration tests, 1 deliberate pin updated: End Event reason-required now mode-aware). Skipped = real-Postgres runner (off by default).
- **Real PostgreSQL 16:** migrations applied cleanly, re-applied idempotently; `supabase/tests/100_finish_round_early.test.sql` **47/47 PASS** (also green through `TIU_PG_TEST=1`). Covers start 1/10/6/14-wrap, 11 holes, 6 holes, scattered, pick-up nine, no scores, marker-only, mixed ack, failed finish fully rolled back, repeat request blocked, frozen after later correction, refresh only changes the changed player, constraints, normal/upcoming/cancelled rounds unaffected.
- Your 22 required scenarios map to: SQL scenarios (nine-hole logic, shotgun, wrap, atomicity, repeats) + `earlyFinishIntegration.test.ts` / `earlyFinish.test.ts` (inclusion defaults, official-points-only counting, excluded round still visible, no zeros, public/PNG/PDF agreement, normal rounds byte-identical, subsequent rounds, End Event/champion independence, lifecycle pins).
- Existing response-equivalence goldens for the leaderboard still pass (normal rounds return identical bodies: new fields only appear for finished-early rounds).
- Type-check of changed files: no new diagnostics vs v3 (the remaining ones are pre-existing stub artefacts); lint-style/hooks scan clean; no `<a href="/…">` added. Mutation checks confirmed the new tests fail when the rules are broken.
- Mobile preview (Chromium, 390×844): dialog fits, buttons stay visible, confirm disabled until the mixed-nines box is ticked, correct payload posted; panel, public page, PNG and PDF render the labels (`design-preview-finish-early-2026-10-25/`).

**NOT verified (needs you / a staging project)**
- Real Supabase (PostgREST RPC array/uuid serialisation, RLS, service-role grants), `next build`, `next lint` — unavailable here. My Postgres had stubs for Supabase roles/auth; unrelated moments migrations 086/088 errored in my scratch chain and were not investigated.
- Samsung/iPhone behaviour, real shared-device/paper rounds, real score-override flow end to end.
- LiveLeaderboard and My HQ panels were type-checked and previewed in isolation, not driven against live data.
- Lint note: new server code uses the repo's existing `// eslint-disable-next-line @typescript-eslint/no-explicit-any` admin-client pattern; no rule was disabled elsewhere.

## Known notes
- Pre-existing: countback in roundLeaderboard/finalResults uses the round-level start tee, not the per-group shotgun start. Not changed (finished-early results use the correct per-player start via SQL).
- Withdrawn players are excluded; "verification" status is not consulted (canonical stored points are used, as everywhere else).
- Delivered v3 popups still use the older sticky-button padding; only the new dialog has the tidier bar.

## Deployment plan (needs your approval at each step)
1. Back up / snapshot the database. 2. Apply 097→099 as already planned, then **100** on staging; run `supabase/tests/100_finish_round_early.test.sql` there. 3. Deploy this build to a Vercel preview; run the priority test: 18-hole shotgun round, stop after nine, some players ≥9 holes and some fewer → Finish Round Early (count: No, then toggle to Yes) → confirm board/PNG/PDF/public link/presentation → Finish Event (concluded, then separately an ended-early event). 4. Promote to production. Rollback: redeploy v3 (app tolerates 100 present or absent); DB rollback block in migration header (see caution above).
