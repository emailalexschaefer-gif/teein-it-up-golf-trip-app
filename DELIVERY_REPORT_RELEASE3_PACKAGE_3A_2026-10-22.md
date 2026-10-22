# Teein' It Up — Release 3, Package 3A: Server Performance & Smarter Polling

**Date:** 22 Oct 2026 · **Base:** verified Release 2 (Phase A) source · **Status:** packaged for review. **Not deployed. Not build-verified** (see section 5).
**Scope:** Package 3A only. Nothing from 3B, 3C or Release 4 is included.

---

## 1. Headline

- Independent read queries are now issued together in the trip layout, `leaderboard`, `tournament` and `my-scores`. Authentication, authorisation gates, response bodies, status codes and error behaviour are unchanged. This is proven against goldens recorded from the **original** routes (54 scenarios, every error path included).
- The three screens that ran their own timers (`my-stats`, pending-verification card, side-comp entry panel) now pause while hidden, refresh immediately on return, and can never overlap requests. `SideGamesClient` now refetches on return.
- **Nothing in scoring, offline sync, reconciliation, lifecycle, RLS or the service worker was touched.**
- **Measured vs estimated:** every timing below is a **simulation** (a fake database with fixed per-query latency). There is no production telemetry, so **no real-world millisecond or percentage improvement is claimed**. The real figure will come from the `Server-Timing` header and `api_timing` events Phase A added.

## 2. Priority 1 — Hosting region (finding: not determinable from here)

- Neither region is recorded in the repository (no `vercel.json`, no region setting in `next.config.ts`), and this sandbox cannot read the live response headers (the proxy returns 403 for the production URL) or either dashboard.
- **How to read it in 2 minutes:** Vercel → Project → Settings → Functions → *Function Region*; Supabase → Project Settings → General → *Region*. Or open DevTools on any API call in production and read `Server-Timing: …region;desc="<code>"` (added in Phase A).
- **Recommendation (conditional, for your approval):** if they differ, align the Vercel function region to the Supabase region (Vercel setting, or `"regions": ["<code>"]` in `vercel.json`). This matters because each database round trip from a mismatched region can cost tens to ~150+ ms **per query** (estimate, not measured), and the sequential waves removed here multiply that. **I have changed nothing in infrastructure.**
- If you send me the two region values I will confirm in one line whether a change is warranted.

## 3. What changed

### 3.1 Exact files changed (8 modified, 17 new)

**Modified**
| File | Change |
|---|---|
| `src/app/api/trips/[tripId]/rounds/[roundId]/leaderboard/route.ts` | Wave 1: membership ∥ practice ∥ round. Wave 2: all-rounds list ∥ holes ∥ scorecards. Gates keep their original order. |
| `src/app/api/trips/[tripId]/rounds/[roundId]/tournament/route.ts` | membership ∥ round; then holes ∥ groups ∥ scorecards ∥ members ∥ markers ∥ side-comps; changes ∥ entries; Moment image lookups started together (one per distinct Moment). |
| `src/app/api/trips/[tripId]/rounds/[roundId]/my-scores/route.ts` | membership ∥ round; then all scorecards ∥ shared-device inputs ∥ markers; then the two override-audit lookups together. |
| `src/app/(app)/trips/[tripId]/layout.tsx` | Now calls the extracted loader; same redirect. |
| `src/app/(app)/trips/[tripId]/rounds/[roundId]/my-stats/page.tsx` | Uses the visibility poller (poll now returns its promise). |
| `src/components/scoring/PendingVerificationCard.tsx` | Uses the visibility poller. |
| `src/components/scoring/SideCompEntryPanel.tsx` | Uses the visibility poller for the status refresh only. |
| `src/app/(app)/trips/[tripId]/sidegames/SideGamesClient.tsx` | `staleTime: 0`, `refetchOnWindowFocus: true`. |

**New**
- `src/lib/trips/tripLayoutData.ts` (+ `.test.ts`) — layout loader.
- `src/lib/polling/visibilityPoller.ts` (+ `.test.ts`) — pause/resume/no-overlap poller.
- `src/lib/perf/routeEquivalence.test.ts`, `src/lib/perf/routeConcurrency.test.ts`.
- `src/lib/perf/goldens/{my-scores,leaderboard,tournament}.json` — recorded from the original routes.
- `src/lib/perf/harness/` — `fakeDb.ts`, `fixtures.ts`, `scenarios.ts`, `runRoute.ts`, `state.ts`, `stubs/*` (test-only; not imported by the app).

**Not touched:** score write routes, `src/lib/db/*` (Dexie queue and `sync.ts`), reconciliation, shared-device/paper logic, round lifecycle, handicap/leaderboard calculations, side-game scoring, Makers & Breakers, Event Memories, slideshow, middleware, service worker, migrations, `package.json`.

### 3.2 Query optimisations

| Route | Serial round trips before → after | Gates still run before heavy reads? |
|---|---|---|
| Trip layout | 4 → 2 (user, then 3 lookups together) | n/a (user check first, `/login` redirect, nothing else queried) |
| `leaderboard` | 7 → 3 (for a two-round event; each earlier round adds a wave of 3 that was already parallel inside) | Yes: 403 / practice 200 / 404 evaluated in the original order |
| `tournament` | 13 → 4 | Yes: 403 (organiser only) / 404 before any heavy read |
| `my-scores` | 8 → 3 | Yes: 403 / 404 / 400 before any score read |

Query *count* is essentially unchanged; they now overlap. One deliberate difference: `tournament` looked up a Moment once **per entry referencing it**; it now looks up each distinct Moment once (13 → 12 queries in the fixture). Responses are identical.

How error behaviour was preserved: queries started early have their failures captured and re-raised at the exact point the original code would have thrown or tolerated them, so the original try/catch semantics, 500s and tolerated-error paths are unchanged, and no unhandled rejections occur.

### 3.3 Polling

**Correction to my earlier audit.** I said polling should be made to pause when hidden. On inspection, every react-query poll (`refetchInterval`) **already pauses in hidden tabs** (`refetchIntervalInBackground` is off) and the live screens already use `staleTime: 0` with refetch-on-focus. The real gaps were:

| Site | Before | After |
|---|---|---|
| `my-stats` (8 s), pending-verification card (15 s), side-comp entry panel (15 s) | Plain `setInterval`; ran while hidden; could overlap a slow request | Visibility poller: no timer while hidden, immediate refresh on return, next tick scheduled only after the previous finishes |
| `SideGamesClient` | App default `staleTime` of 60 s → returning within a minute did not refetch | `staleTime: 0` + refetch on focus |

**Deliberately unchanged:** chat stays at 4 s (it was specified as 3–5 s to feel live); score screen (7 s until reconciled), leaderboard, tournament, my-round (8 s); offline sync interval; `LiveLeaderboard`'s 10 s local re-render tick. Adaptive/slower chat while idle is a product decision, so I've left it as an option for you rather than doing it silently. No Supabase Realtime.

Caveat: mobile browsers already throttle or suspend timers in background tabs, so the saving on the three screens is real but smaller than a naive "requests per hour" count; I'm not quoting one.

## 4. Before / after findings

**Measured (deterministic, in this sandbox):**
- Serial waves and overlap, from recording every simulated query's start and end (table above).
- Simulated wall-time, original Phase A routes vs new routes, same harness, median of 5, identical responses confirmed on every run:

| Route (simulated latency per query) | 20 ms | 60 ms |
|---|---|---|
| `my-scores` | 164 → 62 ms | 483 → 182 ms |
| `leaderboard` (2-round event) | 143 → 62 ms | 424 → 183 ms |
| `tournament` | 306 → 104 ms | 906 → 302 ms |

These show the *shape* (roughly the hop count falling by 2–3×). They exclude the auth call, network to the browser, JSON size and real Supabase variance.

**Estimated, not measured:** real saving ≈ (round trips removed) × (real function-to-database round-trip time). With a co-located region that is likely modest; with a mismatched region it is larger, and the region fix would compound it. **Real figures:** compare `Server-Timing: app;dur` and `api_timing` (`server_p50_ms`) before/after for `my-scores`, `leaderboard`, `tournament`.

## 5. Test results and build status

- **Full suite: 1196 / 1196 pass** (1110 at Phase A + 86 new), run in the working tree and again in a fresh extract of the delivered ZIP.
- New tests: 54 response-equivalence (51 scenarios + 3 golden-completeness checks), 14 gate/concurrency/scoping, 9 layout loader (incl. every membership × practice × active-round outcome vs the legacy logic, plus hang/timeout cases), 9 poller.
- Scenarios cover: signed-out (401), non-member (403), wrong-event round (404), group_scorer (400), practice event, multi-round events and round transitions (round 1 completed + round 2 active, back-9 start), shared-device and paper partners, marker pairs, solo players, organiser with withdrawn card, completed round, each query failing as an error, and as a network throw, and results independent of query completion order. A scoping test asserts every score/membership read is filtered by the requested round or event (no cross-event leakage).
- Static checks on changed/new files: syntax check, my ESLint-rule approximation and React-hooks check clean; strict TypeScript check clean on the new pure modules.
- **NOT done — real `tsc`, `next lint`, `next build`:** no `node_modules` or network install is available in this sandbox. **This package is not build-verified.** Your Vercel build is the gate (lint errors fail the build). I tried to keep every change lint-conservative, but I cannot prove it.
- **Not tested here:** real Supabase/RLS behaviour, real devices, real timing.
- Note: the repo's `npm test` script only globs `src/lib/scoring/**`. Run the full suite with `node --import tsx --test $(find src -name "*.test.ts" -o -name "*.test.tsx")`. I did not change `package.json`.
- Offline/reconnect: no file in `src/lib/db`, the score shells or the service worker changed; the Dexie queue and sync interval are untouched.

## 6. Known risks

1. **Build not run** (above). Lowest-confidence area: none specific, but the unverified lint is the main residual risk.
2. **Higher short-burst concurrency on the database** (up to 6 simultaneous reads per request instead of 1). Fine for Supabase at event scale; worth watching only if many phones hit the same route in the same second.
3. **Layout worst-case timing changed in your favour:** previously membership + practice + active round could take up to 4 + 4 + 10 s in sequence on a bad connection; now bounded by 10 s. Behaviour per lookup is identical.
4. **Goldens come from a fake database**, so they prove equivalence of the *route logic*, not of PostgREST/RLS. Real-device acceptance is still the final gate.
5. The poller schedules the next tick after the previous finishes, so effective cadence is interval + request time (e.g. ~8.3 s instead of 8 s). Intentional (prevents overlap).
6. Region: unknown until you read the dashboards.

## 7. Rollback

- Whole package: redeploy the previous Vercel deployment, or re-upload the Phase A ZIP (`teeinitup-v2-phase-a-performance-2026-10-22.zip`).
- Selective (each is independent): restore just that file from the Phase A ZIP — the three route files, `layout.tsx` (also remove `tripLayoutData.ts`), or the four polling files (`my-stats/page.tsx`, `PendingVerificationCard.tsx`, `SideCompEntryPanel.tsx`, `SideGamesClient.tsx`). Tests and harness files can stay or go.
- No migrations, no data changes, nothing to undo in the database.

## 8. Real-device checklist (iPhone Safari, installed iPhone PWA, Android Chrome, installed Android PWA)

**Scoring (must not regress)**
1. Start a round, score several holes; confirm scores save and the Hole summary is correct.
2. Self+marker pair: both cards show; partner's score appears within ~8 s; Card 2 does not disappear after the first poll.
3. Shared-device (digital + paper) pair: partner card persists across polls.
4. Airplane mode: score 2–3 holes offline, reconnect, confirm they sync and reconcile.
5. Round starting on the 10th tee, and a two-round event moving from Round 1 to Round 2: correct round, correct cumulative leaderboard.
6. Organiser override: audit indicator shows for both players.

**Pages affected by this package**
7. Leaderboard: totals/positions match the previous release for the same event; refreshes while scoring.
8. Tournament / My HQ (organiser): side games, lead changes, Moment photos all appear.
9. Switch between trip tabs: nav shows organiser items only for organisers; Scorecard button jumps to the live round; round-start banner appears.
10. Non-member / wrong-event link: still blocked.

**Polling**
11. Open Side Games during an active round, lock the phone for 1+ minute, unlock: it refreshes immediately.
12. Practice round → My Stats: switch away and back; refreshes on return.
13. Side-comp claim: marker sees a pending verification within ~15 s; hidden-then-visible refreshes at once.
14. Chat still updates about every 4 s.

**Evidence to send back:** (a) the two region codes, (b) a `Server-Timing` value for `my-scores`, `leaderboard`, `tournament` before/after if you can capture them.

## 9. Not started (awaiting your review)
Package 3B (premium native-app polish), Package 3C (media and PWA), Release 4 (shareable presentations).
