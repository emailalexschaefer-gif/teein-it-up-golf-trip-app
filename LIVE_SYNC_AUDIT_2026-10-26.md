# Live synchronisation audit and fixes — 26 Oct 2026 field test

Baseline: consolidated V4 (Packages 1–3 + migration 102). Nothing deployed, no SQL run on production.

## Shared architecture audit (brief §7)
- **There is no Supabase Realtime anywhere in the app** (no `.channel(`/`postgres_changes`). Every live screen is TanStack Query polling with refetch on window focus and on reconnect (scoring 7s, chat 4s, live boards 8s, home 20s) plus a small visibility poller for three panels. The public leaderboard has its own timer.
- Browser/PWA caching is **not** a cause: all the relevant API routes are `force-dynamic`, and `public/sw.js` passes every `/api/*` request straight to the network.
- The three defects found are different, and none is "missing realtime", so **no new realtime framework was built** (per the brief):

| # | Symptom | Class of failure | Root cause | Status |
|---|---|---|---|---|
| 1 | Partner "Waiting for TEST" never clears | **Display** (data was fetched) | The panel gates read the page's server-rendered `markedScorecard` prop (frozen at first paint) while the 7s live query already had the partner. Once the pairing existed the screen showed the waiting card forever; only a remount re-read the prop. | Fixed (code + tests) |
| 2 | Organiser and player see different Event Chat histories | **Authorisation** (RLS), not fetching | Every sender writes event-wide posts as `recipient_type = 'all'` once 102 lets it be stored. If production's SELECT policy doesn't treat `'all'` as event-wide, those rows are visible to their **sender only**. That reproduces the exact report: organiser sees the arrangements announcement (they sent it); the player sees their own photo and Longest Drive post (they sent them). Chat already polls every 4s. | Reproduced on scratch DB; **needs your one read-only confirmation** (see below); fix = migration 103 |
| 3 | Public leaderboard doesn't update | **Fetching** (too slow + cached) | Page polled every **30s**, and the API was cached at the CDN for `s-maxage=15` **plus** `stale-while-revalidate=30`, so a spectator could be ~75s behind. "Last updated" showed server-generation time, not the last successful refresh. | Fixed + real-browser verified |
| 4 | Round 2 hole pars missing | **Data** | Pars come only from the round's own frozen course snapshot; a round whose course/tees weren't chosen from the Course Library has none. Not invented or copied from Round 1. | Setup warning added; row check below |

## Fixes
**Bug 1 — partner sync** (`SelfMarkerScoreShell.tsx`, new `lib/scoring/partnerPresence.ts`): panel and its gates now use the live query. A self-clearing "TEST hasn't started scoring yet. This updates automatically." note shows only while the partner has no entries; it never hides or disables scoring. "Refresh Playing Partner" now does a `cache: 'no-store'` read. The submit-time rejected-entry check uses the live partner id. Unchanged and re-pinned by tests: the refresh never touches the current hole or drafts, and queued (unsynced) strokes are overlaid on every refresh. Background/resume and reconnect use the existing focus/reconnect refetch.

**Bug 2 — chat** (`supabase/migrations/103_event_messages_read_all_and_event.sql`): replaces only the SELECT policy so `'all'` and legacy `'event'` posts are visible to every member **of the same event**; group, player-targeted, sender-own and other-event rules unchanged. Widening only; touches no rows, constraints or other policies. Preflight check 34 now **FAILs** unless the policy shows both values (it previously only looked for `'event'`, which a stale policy also satisfies — my earlier "34 = OK is enough" was wrong).

**Bug 3 — leaderboard** (`PublicLeaderboardView.tsx`, `lib/leaderboardShare/refreshPolicy.ts`, `api/l/[token]/route.ts`): poll every 12s while visible; immediate refresh on tab-visible and on coming back online; nothing pending while hidden; one request at a time; backoff to 60s while failing; notice only after two failures in a row or 90s without success; "Last updated hh:mm:ss" is the real last-success time; CDN cache `public, s-maxage=5` with no stale window. Token gate, read-only, 404-on-revoked and privacy headers unchanged. Two older test pins (30s poll, 15s/30s cache) were updated deliberately.

**Bug 4 — pars** (`holeOptionLabel.ts`, `StepRounds.tsx`): the Side Game hole picker now shows a clear warning when the round has no (or partial) course data and tells the organiser to choose that round's course and tees. Pars still come only from that round's own snapshot.

## Your read-only confirmations (nothing here writes)
1. **Chat:** run `supabase/diagnostics/event_chat_visibility_diagnostic.sql` (blocks 1 and 2; block 3 per person). Block 1 should show the SELECT policy; if its `qual` lacks `'all'` (or `'event'`), 103 is the fix. If it already contains both, send me blocks 2 and 3 — then the cause is something else and I won't guess.
2. **Pars:**
```sql
SELECT r.name, r.course_name, r.tee_name, r.holes, r.starting_hole_number,
       jsonb_array_length(r.library_holes_snapshot) AS snapshot_holes
FROM rounds r JOIN trips t ON t.id = r.trip_id
WHERE t.name ILIKE '%YOUR EVENT NAME%' ORDER BY r.play_date, r.created_at;
```
`snapshot_holes` NULL/0 for Round 2 = no course data (edit the event and choose its course and tees).

## Tests
- Full TypeScript suite: **1518 / 1518 pass** (V4 had 1506; the +12 are new tests for the partner gate, the leaderboard refresh policy and par coverage).
- SQL on scratch PostgreSQL 16: release (9 scenarios), stale-constraint repro, production-constraint repro (102), **chat visibility under real row-level security (103: 3 PASS)**, plus-handicap Stableford. Preflight on scratch: no FAIL rows; check 33 and 34 = OK.
- **Real Chromium** (public leaderboard, real component, mocked API): 11/11 — auto-update within 15s (13.4s), no reload, scroll kept, one request at a time, no polling while hidden, immediate refresh on return, stale notice and recovery, revoked link.

## Could NOT be run here (be explicit)
- `tsc`, lint and `next build` (no npm registry): Vercel's build is the first real compile. A syntax check and the import-hygiene test passed.
- The scoring shell in a real browser (needs react-query/dexie/zustand, unavailable): the partner fix is verified by unit tests and source pins, **not** by clicking through it. Two-phone scoring, offline/reconnect and background/resume on real Android/iPhone remain device tests.
- Anything against your live Supabase, the live public link/CDN, or the real chat on two devices.
