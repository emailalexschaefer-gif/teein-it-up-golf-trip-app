# Connectivity & Offline Scoring Readiness Audit — Phase A (16 Oct 2026)

**Scope:** audit only. No production code was changed. Phase B is not started.
**Method:** every claim below is traced to code (file and line). The sandbox has no IndexedDB, Dexie, Supabase or real phone, so nothing here was exercised at runtime. Where a finding depends on runtime or device behaviour it is marked **NOT VERIFIED** with the exact test needed. "Confirmed by code" means the code path is unambiguous. It does not mean it was observed on a phone.

---

## Headline

Offline scoring is **partly real**. It is not an architectural intention, and it is not safe to rely on yet.

- **Real:** a durable local queue (Dexie / IndexedDB) that is written before any network call, an automatic retry loop, server-side duplicate protection, and a server gate that refuses to finalise a card unless the server holds every score.
- **Missing:** the app cannot be reopened or reloaded without signal, because the service worker deliberately does not cache pages. There is no offline indicator and no request timeout.
- **Real defects that can strand or lose a score:** see section D.

Verdict (section G): **conditionally usable with operational restrictions now. A small Phase B package is strongly recommended before the trip.**

---

## A. Current architecture

**Score entry (the default `self_and_marker` and `individual` modes use `SelfMarkerScoreShell.tsx`; only legacy `group_scorer` uses `ScoreSessionShell.tsx`, `page.tsx:251`).**

1. The player types a score into **React state only** (drafts, `SelfMarkerScoreShell.tsx:447`). Nothing is persisted yet.
2. Navigation is the save boundary: Next hole, Previous hole and swipe all call `saveAndAdvance()` → `saveCurrentHoleData()` (`:1003`). The UI state is updated first (`setMySelf`, `:1017`), then `queueScoreEntry()` writes to **IndexedDB** (`src/lib/db/dexie.ts`, DB `teeinitup_v1`, table `scoreQueue`).
3. `syncScoreQueue()` (`src/lib/db/sync.ts`) reads queue rows with status `pending` or `error`. For each row it marks it `syncing`, `POST`s to `/api/scores`, and on any `res.ok` marks it `synced`.
4. **Triggers:** after each save, on the browser `online` event, on mount of any authenticated page (`SyncInitializer` in `(app)/layout.tsx:91`), and every 8 s while `pendingCount > 0` (`sync.ts:155`).
5. **Server (`/api/scores`):** validates, authorises (capture mode, marker assignment), then upserts into `score_entries`. The unique keys are `(scorecard_id, hole_id, capture_role)` and `client_id`. A Postgres trigger computes Stableford. Leaderboards read `score_entries` directly, so a delayed score flows through on the next 8 s poll (`LiveLeaderboard.tsx:156`).
6. **Self and marker are separate rows** (`capture_role`), so partners never overwrite each other.
7. **Finalising:** `POST /scorecards {action:'submit'}` checks the **server's** rows. It needs every hole's self entry, and in `self_and_marker` mode a matching marker entry. Round close (`close/route.ts`) also checks server data.

**Offline shell:** `public/sw.js` caches only `/brand/*`, the manifest, favicons and icons. It states in its own header that it is "deliberately NOT an attempt to make this app work offline". Every page navigation and every `/api/*` call goes straight to the network. There is no offline fallback page.

---

## B. Evidence summary (implemented vs intended)

| Capability | Status | Evidence |
|---|---|---|
| Persistent local queue (IndexedDB) | **Implemented** | `dexie.ts:5`, `queueScoreEntry` `:50` |
| Local write before server | **Implemented** | `queueScoreEntry` then `syncScoreQueue()` (`SelfMarkerScoreShell:1018,1055`) |
| Auto retry | **Implemented** | `sync.ts:117-156` |
| Duplicate prevention | **Implemented, with a defect** | `scores/route.ts:136-143`, `UNIQUE(client_id)` |
| Overlay of unsynced local scores on reload (when online) | **Implemented** | `getQueuedEntriesForScorecards`, hydrate `:721` |
| Sync-status label | **Partial** | `syncStore.ts`, label at `:1159` |
| Offline page load / reopen | **Not implemented** (by design) | `sw.js` header |
| Offline indicator | **Not implemented** | no `online`/`offline` UI anywhere in scoring |
| Request timeout | **Not implemented** | no `AbortController` in `sync.ts` |
| Queue scoped per user | **Not implemented** | `OfflineScoreEntry` has no user field |
| Queue tests | **None** | no test imports `dexie.ts` or `sync.ts` |

---

## C. Gap analysis (PASS / PARTIAL / FAIL / NOT VERIFIED)

**Scenarios**

| Scenario | Result | Why |
|---|---|---|
| A. Reception drops mid-round, page stays open | **PARTIAL (likely PASS for the happy path; NOT VERIFIED on device)** | Scores queue locally, hole navigation is client-side, and local scores stay editable. Sync resumes on `online` or the 8 s timer. Defects D1–D4 apply. |
| B. App closed or phone locked, reopened offline | **FAIL** | Local data survives in IndexedDB, but the scorecard cannot open offline (navigation is network-only). The score is not lost, it is unreachable until signal returns. On reopen with signal, `SyncInitializer` uploads it. |
| C. One partner offline | **PASS (by code)** | Rows are separate per role. The partner's missing marker row shows `pending_marker`, and the server refuses to finalise until it matches, so nothing is silently verified. Not device-verified. |
| D. Conflicting scores | **PASS (by code)** | Self and marker are separate rows. A mismatch is flagged (`comparison.ts`) and submit is blocked. The organiser can resolve it (admin override, audited). |
| E. On/off flapping | **PARTIAL** | Retry works and `client_id` prevents duplicates, but D1, D2 and D4 are hit most often in exactly this scenario. |
| F. Slow or timing-out connection | **FAIL** | No timeout. One hung request blocks the whole queue for as long as the browser holds it (D3). The label stays "Saving…" and Sync Now is disabled. Score entry is not blocked, because writes are local first. |

**Checklist**

- **A. Local storage:** IndexedDB, written before the server, survives refresh and restart (PASS, not device-verified). Scoping is by scorecard id and not by user. Sign-out clears React Query only, never Dexie (`AppNav.tsx:35`, `AuthCacheManager`). **PARTIAL.** If storage is unavailable, full or cleared, see D5. **FAIL.**
- **B. Offline navigation:** open scorecard works, next and previous hole work, correction works (PASS by code). Reloading the scoring screen offline fails. Holes are fetched client-side on mount (`:680`), so a remount offline shows a misleading "No holes found — run migration 004" message. **FAIL.**
- **C. Synchronisation:** persistent queue PASS. Triggers PASS. Retry PASS. Idempotency **PARTIAL** (D1). Older queued value overwriting a newer correction: not at the queue level, because edits replace in place. Lost ack: the retry is safe for an unchanged score (PASS) but unsafe after an edit (D1). Pending cleared only on confirmed success: **FAIL** (D2, D6).
- **D. Integrity:** own and marker records preserved PASS. Conflicts PASS. Shared-device or paper partner **FAIL** (D4). Offline score shown as verified: PASS. Finalise with pending scores: PASS, enforced server-side. Organiser round close with pending: PASS, blocked by server data (but see D7). Delayed scores update Stableford, stats and leaderboard: PASS by design (trigger plus direct reads).
- **E. UI:** offline indicator **FAIL**. Pending count shown when `> 0`: PASS. Failure visible: **PARTIAL** (shows `⚠ N pending` but not why). Avoids claiming saved when not saved: **FAIL** (D4, D5).
- **F. Related features:** NTP and Longest Drive claims need connectivity. They are explicitly not queued and show an honest offline message (`SideCompEntryPanel.tsx:240`), and they cannot disturb scoring. Chat, photo or video Moments, Round Summary and Live Leaderboard all need connectivity (no queue, no cache). Playing-partner verification and final confirmation need the server by design. All acceptable provided the limitation is communicated.

---

## D. Risk assessment — defects that can lose or strand a score

Ordered by severity. All were found by code reading and not reproduced at runtime.

**D1. HIGH — an edit made after the first send can be silently dropped.**
`queueScoreEntry` reuses the same `client_id` for any unsynced row (`dexie.ts:53-58`). The server returns `200 "Already recorded"` for a known `client_id` **without updating the row** (`scores/route.ts:136-143`). Sequence: send (server stores 5) → the player edits to 4 before or after the reply is lost (likely on a slow connection) → the retry carries the same `client_id` → the server ignores it → the client marks it `synced`. The server keeps **5**, the phone shows 4, and nothing flags it. The existing in-flight-edit guard in `markEntrySynced` only delays the problem to the retry.

**D2. HIGH — an entry can be stranded forever in `syncing`.**
`sync.ts:77` sets `syncing` before the request. `getPendingEntries` and `getPendingCount` only look at `pending` and `error` (`dexie.ts:72,110`). Nothing ever resets `syncing`. If the page is killed mid-request (iOS suspension, phone lock, closed app on bad signal), the row stays `syncing`: it is never retried, never counted, and the UI can show "Saved" or no warning. The player later sees "Score entry isn't complete — 17 of 18" from the server while their screen shows 18. Sync Now cannot help. There is no UI to see or recover it.

**D3. MEDIUM-HIGH — no request timeout.**
`fetch('/api/scores')` has no abort. A hung request on a weak 4G connection holds `syncInProgress` (`sync.ts:8,31`), so later saves are queued locally but not sent until the browser gives up. Nothing is lost, but the player sees "Saving…" for minutes, and D2 becomes more likely.

**D4. HIGH for shared-device pairs — the paper partner's score is not queued at all.**
In shared-device mode the second player's score is a plain `fetch` to `/shared-device-score` (`:1038`), not the queue. Offline, the fetch throws and the generic catch shows **"Saved locally — will sync when online"** (`:1080`), which is false for that score. `setPartnerMarker` already showed it as entered, and the score is only in React state. This is a direct breach of the hard boundary. The same catch fires for an HTTP failure of this call.

**D5. MEDIUM — false "Saved locally" message if the local write fails.**
If IndexedDB is unavailable, full or cleared, the `catch` shows the same "Saved locally" toast even though nothing persisted, and the hole advances. Low probability, but it breaks the hard boundary.

**D6. MEDIUM — a captive portal or proxy can falsely confirm a score.**
Sync treats any `res.ok` as confirmation and never reads the body (`sync.ts:93`). A club Wi-Fi portal or a middleware redirect returning an HTML `200` would mark scores `synced` while the server holds nothing. The local row is then ignored on reload. **NOT VERIFIED** whether an expired session produces this (middleware redirects unauthenticated requests to `/login`). Test: expire the session, then score.

**D7. MEDIUM — permanently rejected entries are never cleared and block confirmation.**
A `422` such as "Round is not active" or "Scorecard not active" (for example after the organiser corrects a card manually, then closes the round) leaves the row in `error`, retried every 8 s forever. `pendingCount` is **global**, and `isReadyToConfirm` requires it to be 0 (`:1482`). A stuck Round 1 entry can therefore block "Confirm Final Scores" in Round 2 on that phone. There is no delete or discard anywhere in the codebase.

**D8. MEDIUM — the queue is not user-scoped.**
Two accounts on one phone share the queue. After switching accounts, the new user's sync would attempt the previous user's rows (rejected with 403, which then triggers D7) and inflate the pending count.

**D9. MEDIUM — typed but unsaved drafts are lost if the app is killed.**
A score exists only in React state until the player navigates. Locking the phone or closing the app after tapping a score but before moving on loses it. There is no `visibilitychange` or `pagehide` save.

**D10. LOW — stale display after sync.**
After a queued score syncs, the screen reads server data again only on the next poll. If the poll started before the write landed and polling has stopped (all holes done), a hole can appear blank until the next focus or refetch. Display only, no data loss.

**Also relevant:** stored data can be evicted by iOS Safari if the app is not installed to the Home Screen (no `navigator.storage.persist()` call exists). The installed PWA is much safer. A SELECT-then-write race in `/api/scores` is self-healing on retry.

---

## E. Recommended fixes (Phase B proposal — not started)

Smallest safe package, ordered by severity, then regression risk:

| # | Fix | Closes | Size | Risk |
|---|---|---|---|---|
| 1 | Server: if a known `client_id` arrives with **different** values, update the row (identical resend stays a no-op). | D1 | ~15 lines, one route | Low |
| 2 | Queue: treat `syncing` as pending on startup and whenever older than ~30 s; include it in the pending count. | D2 | ~10 lines in `dexie.ts` | Low |
| 3 | Sync: 15 s `AbortController` timeout, and require a JSON body with an `id` or the `conflict` flag before marking `synced`. | D3, D6 | ~15 lines in `sync.ts` | Low |
| 4 | Shared-device partner score: stop claiming "saved locally". Keep the draft, show "Not saved — no signal, record on the paper card", and do not advance. (Queueing it properly is a larger change; defer.) | D4 | Small | Low |
| 5 | Truthful toasts: distinguish "saved on this device" from "could not save". | D5 | Small | Low |
| 6 | Visible status: offline banner plus the suggested wording ("Saved on this device — waiting to sync", "Syncing scores…", "All scores synced", "Sync failed — scores remain on this device"), using the existing label area. | E | Small | Low |
| 7 | Rejected-entry handling: treat permanent 4xx rejections as `rejected`, exclude them from `pendingCount`, and show them with a Discard action. | D7 | Medium | Low-medium |
| 8 | Save the draft on `pagehide` / `visibilitychange`. | D9 | Small | Low |
| 9 | Scope the queue by user id (Dexie v3 upgrade) and clear on sign-out. | D8 | Medium | Medium (touches the Dexie schema) |
| — | **Defer:** offline app shell (service-worker page caching). It risks serving stale code in a live app and needs careful versioning. A dedicated project after the trip. | B | Large | High |

**Recommended pre-trip minimum: 1, 2, 3, 4, 5 and 6.** Items 7 and 8 are strongly desirable. Item 9 matters only if phones are shared.

---

## F. Test plan

**Automated (new, pure-logic where possible):** sync loop, queue and dedupe against an in-memory fake (Dexie and `fetch` stubbed): edit-after-send updates the server row (D1); a `syncing` row is recovered (D2); timeout produces `error` and retry; an HTML `200` is not marked synced (D6); the status label for each state; the server route accepts a same-`client_id`, different-value request. These need the real Dexie, so the queue tests need `fake-indexeddb` (not installable in this sandbox, so they would run in your CI or locally).

**Real-phone tests (Android Chrome PWA and iPhone Safari PWA). All are NOT VERIFIED today.** For every row, check the server record (Supabase `score_entries`) and not just the UI.

| Test | Expected | Maps to |
|---|---|---|
| Airplane mode on Hole 3, score Holes 3–5 | Saved locally, advance works | A |
| Go back to Hole 3 offline | Original value shown, editable | A |
| Edit Hole 4 twice offline, then reconnect | Server holds the latest value only | A, D1 |
| Throttle to ~50 kbps (DevTools or Network Link Conditioner), edit a score within 2 s of confirming | Server holds the edited value | D1, F |
| Lock the phone offline, reopen the app (still offline) | Document the result (expected: cannot open). Then restore signal: scores sync | B |
| Force-close the app while "Saving…" on a hung connection, reopen online | All holes reach the server (expected to FAIL today) | D2 |
| One partner offline, then reconnect | Both records land, match shown | C |
| Both partners offline | Both sync with no duplicates | C |
| Conflicting scores | Mismatch preserved, flagged, resolvable by organiser | D |
| Toggle airplane mode 5× during entry | One row per hole and role in the server | E |
| Join a captive-portal Wi-Fi or expire the session, then score | Not marked synced | D6 |
| Shared-device pair offline | Honest "not saved" message (after fix 4) | D4 |
| Confirm with pending scores | Blocked, with a clear message | D |
| Organiser close with an unsynced card | Blocked, listing the player | D |
| Organiser batch override, then check leaderboard, stats and Makers & Breakers | All reflect the override. (The code says they read `self` rows; confirm the M&B screen on device.) | Section 5 contingency |
| Round 1 → Round 2 on the same phone | No Round 1 rows interfere (pending 0) | D7 |
| Account switch on one phone | No cross-user rows (after fix 9) | D8 |

---

## G. Golf-trip readiness verdict

**Not yet safe to depend on unattended with intermittent coverage. It is usable now with the restrictions below, and substantially safer after Phase B fixes 1–6.**

What works today: with the scoring screen kept open, a player can keep entering and correcting scores through a signal loss, and the scores sync when coverage returns. The server will not let anyone finalise or close a round on incomplete data.

What can go wrong today: D1 (an edit overwritten by an older value), D2 (a score stranded after a forced close), D4 (the paper partner's score reported as saved when it is not), and the app being unopenable without signal.

**Minimum operational restrictions if no code changes are made before the trip:**
1. Paper scorecard and pencil in every group, filled in **hole by hole**, not just as a backup.
2. Open the scorecard **before** teeing off while there is signal, and do not close, reload or swipe away the app mid-round. Lock the screen rather than closing.
3. Do not correct a score while the label shows "Saving…" or "pending". Wait for "✓ Saved".
4. If a phone shows pending scores or "⚠" after the round, keep the app open with signal for a few minutes. Before confirming, compare the screen with the paper card.
5. The organiser should check each group's card in My HQ (or by the server's "N of 18" message) before closing the round, and use organiser manual entry as the fallback. The batch-override route exists (organiser-only, reason required, audited), and overrides write the same `self` rows that the leaderboard, Stableford and (per code comments) Makers & Breakers read.
6. Shared-device pairs: treat the paper card as the primary record for the paper player.

**Manual-entry contingency (section 5):** the existing organiser override supports it in code (`batch-override/route.ts`, `applyHoleOverride.ts`). Day 2 scoring is per-round, so Day 1 data is not touched. The Makers & Breakers and statistics pass-through is **NOT VERIFIED** on a device.

---

## What I did not verify

- Any behaviour on a real iPhone or Android phone.
- IndexedDB persistence across app kill and reboot, and iOS storage eviction.
- Real server responses from Supabase (RLS, triggers) and the middleware redirect behaviour for expired sessions.
- Makers & Breakers and statistics recalculation after manual entry.
- `tsc` and `next build` (unavailable in the sandbox, unchanged by this audit).

**Stopped after Phase A as instructed. Phase B awaits your approval.**
