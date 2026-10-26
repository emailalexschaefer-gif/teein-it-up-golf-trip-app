# Teein' It Up — V5 deployment guide

**Release:** V5 (live-sync) · **Date:** 26 Oct 2026 · ZIP checksum: supplied with the ZIP (a file cannot contain its own checksum). Per-file hashes: `FILE_MANIFEST_V5.sha256`.
Replacing the application files does **not** touch Supabase. Nothing here has been deployed or applied by Claude.

## 1. Replace the application
1. Extract the ZIP into an empty folder and replace the app files with its contents. Keep your own environment variables (Vercel settings / `.env.local`); the ZIP only has a placeholder `.env.example`.
2. **This project has no `package-lock.json`** (none in any earlier ZIP either, and none can be generated without the npm registry). If your repository already has one, keep it; do not delete it. Without one, Vercel runs a plain `npm install`. Generating and committing a lockfile once, from a machine with npm access, is recommended.
3. Confirm the Vercel build passes. It is the first real `tsc` / lint / `next build` of this code (not run by me — no npm access here).

## 2. Decide which migrations to run (all read-only, in the SQL Editor)
1. Run `supabase/preflight/v5_migration_status.sql`. One row per migration: **INSTALLED** = do not run · **MISSING** = run that file · **PARTIAL** = stop and send me the output.
2. Run `supabase/preflight/101_preflight.sql` (detail checks; expect no FAIL rows after any migrations).
3. For Event Chat, run `supabase/diagnostics/event_chat_visibility_diagnostic.sql` blocks 1–2. **103 is not assumed necessary**: it is needed only if the read policy shown in block 1 (and the status script's 103 row) lacks `'all'` or `'event'`. If it already has both and the two players still see different chats, send me blocks 2–3; the cause is then something else.

| File | Run only if the status script says | Verify afterwards |
|---|---|---|
| `097_round_cancellation.sql` | 097 MISSING | status row 097 = INSTALLED; preflight 40, 41 = OK |
| `098_shared_leaderboards.sql` | 098 MISSING | row 098 INSTALLED; preflight 60 = OK |
| `099_event_outcome.sql` | 099 MISSING | row 099 INSTALLED; preflight 61 = OK |
| `101_round_arrangements_release.sql` | 101 MISSING (never if PARTIAL) | row 101 INSTALLED; preflight 74, 80–83 = OK |
| `102_event_messages_recipient_all_event.sql` | 102 MISSING | row 102 INSTALLED; preflight 33 = OK |
| `103_event_messages_read_all_and_event.sql` | 103 MISSING **and** diagnostic block 1 confirms the policy | row 103 INSTALLED; preflight 34 = OK |

**Never run:** `029_event_messages_recipient_compat.sql`, `supabase/event_messages_deploy.sql`, migration 100 (Finish Round Early is not in this release). Do not run a migration just because it is in the ZIP.

## 3. Order and procedure
Order if several are missing: 097 → 098 → 099 → 101 → 102 → 103. (102 and 103 don't depend on each other or on 101.)
Before the first one: confirm a recovery point (Supabase → Database → Backups / point-in-time) and no active database incident. For each: paste the file into the SQL Editor, run once (each is a single transaction, so a failure changes nothing), rerun the status script, and confirm the row reads INSTALLED before the next.

## 4. If something goes wrong
- **App:** Vercel → Deployments → promote the previous deployment.
- **A migration errors:** nothing was changed (transaction). Send me the error text and the status output.
- **After a successful 102/103:** 103 only widens who can read event-wide posts; to undo, restore the policy text you saved from diagnostic block 1. 102 can be reverted only while no `'all'` message exists (a release announcement is one); otherwise use the recovery point.
- **Confirm & Release still fails:** the message ends with `(ref XXXXX)`; send me that code.

## 5. Fixed vs still unverified
| Item | State |
|---|---|
| Playing-partner auto-sync | Code fix (panel follows live data); unit/source tested, **not** run in a browser. Needs the two-phone test. |
| Event Chat / Moments visibility | Reproduced on a scratch database; **production policy not yet confirmed** — 103 only if the diagnostic confirms it. |
| Public leaderboard refresh | Improved (12s poll, 5s CDN cache, resume/online refresh); real-Chromium tested against a mocked API. Needs a live spectator test. |
| Round 2 Side Game pars | Warning added; **root cause (Round 2's stored course data) still unverified** — run the row check in `LIVE_SYNC_AUDIT_2026-10-26.md`. |
| Presentation applause / fullscreen | Parked. |
| Photo cropping | Future enhancement. |
| `tsc`, lint, `next build`, `npm ci` | **Not run** (registry unreachable; no lockfile). Vercel build is the first real compile. |

## 6. Acceptance test — Phone A (Alex), Phone B (TEST), organiser screen, spectator device
1. Organiser: Round 1 → Confirm & Release. Expect "Released (version 1)"; both phones show **one** arrangements announcement in Event Chat without reloading; scoring stays locked until Start Round.
2. Phone B posts an Everyone photo Moment; A and the organiser see it within ~5s. A Side Game lead changes: all three see the announcement. A group-only Moment stays within its group.
3. Start Round. Phone A opens the scorecard first and selects TEST: it shows "TEST hasn't started scoring yet. This updates automatically." and still lets A score.
4. Phone B opens its scorecard and scores a hole: within ~10s A's note clears and B's score appears **without leaving or reloading**; "Refresh Playing Partner" also works.
5. Matching, then mismatching scores: status updates on both; the mismatch warning never blocks play.
6. Background A for a minute and return (refreshes at once, no stroke lost); airplane mode, score, reconnect (syncs).
7. Spectator opens the public link once; B scores: standings update within ~15s, scroll kept, "Last updated" shows a time with seconds. Background and reopen: refreshes at once. Revoke the link: "no longer available".
8. Edit the event: each round's Side Game picker shows its own pars once its course and tees are chosen; a round without course data shows the amber warning.
If a step fails send me the step number, a screenshot and any `(ref …)` code.
