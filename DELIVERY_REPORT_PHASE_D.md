# Teein' It Up — My HQ V2, Phase D — UX Consolidation, Verification & Deployment Gate

**Status: all Phase D tasks (verification + P1 consolidation + P2 audited items) complete.**
**Full test suite: 826/826 passing** (811 before this phase, +15 new regression tests).
**Deployment readiness: see Section 7 — hold for the mobile acceptance walkthrough, as you specified.**

---

## 1. Verification first (P0) — required before anything else

Per your brief, I audited the Phase C workflow against the existing server-side behaviour **by reading the actual route handlers directly**, not by re-trusting an earlier summary.

### 1a. Close Round / Start Round readiness match

- Read `close/route.ts` + `roundCompletion.ts` in full. Confirmed `checkScorecardCompletion()` only checks `selfHoleCount < totalHoles` for both paper and digital scorecards — marker-reconciliation mismatches are **not** a server-side blocker (deliberately removed in an earlier field-test fix, per the code's own comment).
- Confirmed the tracker's `readyToClose` reuses the **existing** Close Round button's own condition (`completionPct === 100 && awaitingReconciliation === 0`) verbatim — never recalculated. That condition is logically stricter than the bare server requirement.
- **Finding, not a defect:** the UI gate has always been more conservative than the server's own minimum. This is pre-existing, intentional behaviour (an existing safety margin), confirmed by direct code read — not something Phase C introduced or something that needs fixing.
- Stage 1 ("Start Round") wording was adjusted from "Ready to prepare and begin play" → "Start when ready" (now further refined in Task #39 below) because the original wording could be read as asserting a readiness check the function never performed. Not a functional defect — the button only ever navigates to the existing Rounds tab, where the real Begin Round wizard validates on submit — but a precision fix, directly addressing the spirit of your concern.

### 1b. React Query cache invalidation — one confirmed, fixed defect

Your suspicion was correct. `MakersBreakers.tsx` managed its own state via raw `fetch()` and had **never** used React Query, despite two other components (`RoundHighlightsSection.tsx`, `MyHQClient.tsx`'s tracker) reading the identical server data via `useQuery` with matching keys (`['published-highlights', tripId, roundId]`).

**Effect of the bug:** after Skip, Publish, or Edit→republish, the tracker and the highlights card could show stale data for up to 60 seconds (until a window-focus refetch), including after navigating away and back.

**Fix:** one line inside the shared `doPublish()` function (covers all three write paths — first publish, Skip, Edit-republish — since they all funnel through it):

```tsx
queryClient.invalidateQueries({ queryKey: ['published-highlights', tripId, roundId] })
```

Verified with 2 new regression tests (`makersBreakersStage4Fix.test.ts`).

### 1c. Round-switching, empty-review persistence, provider/query correctness

- Confirmed each round's workflow is derived independently from that round's own `selected.id`-keyed queries — switching rounds can't leak another round's highlights/completion state (query keys include `roundId`; no shared mutable state).
- Confirmed the "reviewed, zero highlights selected" case persists correctly: a `published_round_highlights` row existing (regardless of `highlights.length`) is what "reviewed" means — this was already the Phase C fix, re-confirmed here, not re-done.
- Confirmed all new queries run under the single shared `QueryClient` from `ReactQueryProvider.tsx` — no second provider, no duplicate network requests introduced.

**No further defects found beyond the one fixed in 1b.**

---

## 2. Consolidate Makers & Breakers entry points (P1)

Three real "openers" existed (not four — `RoundHighlightsSection.tsx` is read-only display, not an opener):

| Entry point | Action |
|---|---|
| `RoundHighlightsCard.tsx` (via Guided Workflow) | **Kept** — now the one obvious primary path |
| `TournamentControl.tsx`'s "ROUND — COMPLETE" card button | **Removed** (redundant with the tracker) |
| `TournamentControl.tsx`'s post-close transient invitation card | **Kept** — genuinely contextual, one-time, not a competing primary button |

No change to highlight generation, scoring, or publication semantics.

## 3. Event Health repositioned (P1)

Moved from mid-page (after the Close Round flow) to the very top of `TournamentControl.tsx`'s render, directly beneath the Guided Workflow tracker. Retitled "Event Health / Progress" → "Event Health". Added `defaultExpanded={data.health.level !== 'green'}` so a healthy event stays collapsed by default and an at-risk one is immediately visible — matching your "organiser should always know what needs attention... without hunting" principle. No information duplicated elsewhere; still focused on operational issues, not workflow progress.

## 4. Round Story vs Event Story (P1)

Audited `EventStorySection`'s actual data scope: it combines the round-scoped `story` prop with an **unscoped, whole-event** `['moments', tripId]` query — genuinely event-wide content. Relabeled "The Story" → **"Event Story"** to match its real scope and its own component name. No change to slideshow generation or content.

## 5. Score Management consolidated (P1)

Two things had both been labeled "Score Management":
- `AdminScoreOverridePanel.tsx` — the real tool (score overrides, reconciliation), mounted independently under `id="score-management"`.
- `TournamentControl.tsx`'s own small Group Map table — relabeled **"Group Map"**, with its redundant inner heading removed and a link added: *"Override a score or manage scorecards → "* pointing at the real anchor.

Both capabilities preserved; only the duplicated label and a redundant heading were removed. Permissions, verification, reconciliation and round-close behaviour untouched.

## 6. Stage 5 — Review & Present deep link (P2, audited first)

Audited the Memories page's slideshow flow before writing anything: `chooseScope(scope: PresentationScope)` is the single function both a manual tap and a deep link now call — `{ kind: 'round'; roundId } | { kind: 'fullEvent' }`. No parallel config system was introduced.

- `MyHQClient.tsx`'s Review & Present action now routes to:
  - `/trips/{tripId}/memories?startSlideshow=event` once every round is closed, or
  - `/trips/{tripId}/memories?startSlideshow=round&roundId={id}` for a single round, or
  - the plain picker (unchanged) otherwise.
- The Memories page reads these via `useSearchParams()` and calls `chooseScope()` once its manifest has loaded. An unknown/mismatched `roundId` is checked against the loaded manifest (`roundExists`) before calling `chooseScope` — it safely falls through to the ordinary picker rather than erroring.
- Deck generation itself is never touched.

5 new regression tests (`stage5SlideshowDeepLink.test.ts`).

## 7. Stage 1 — Start Round readiness (P2, audited first) — now implemented

Per your brief's own fallback instruction ("if not, document the blocker rather than introducing speculative queries"), I audited before building:

1. `tournament/page.tsx` has **no** group/player/handicap data in scope — confirmed by grep.
2. `BeginRoundModal.tsx` (the real Begin Round wizard) already calls `GET /api/trips/{tripId}/rounds/{roundId}/setup-context` for exactly this data, and already runs `resolvePlayingHandicap(playing_handicap, profile_handicap) !== null` as its own per-player check.
3. Read `setup-context/route.ts` in full: it returns `groups: [{ id, name, tee_time, players: [{ member_id, profile_id, full_name, playing_handicap, profile_handicap }] }]` — exactly the shape Phase C's `deriveStartRoundReadiness()` needed, with no reshaping and no new server-side query.

**Conclusion: the endpoint cleanly fits — wired it in**, not documented as a blocker:

- `MyHQClient.tsx` now calls this existing endpoint (`enabled` only while `selected.status === 'upcoming'` — no needless fetching once a round has started), and computes `groupCount`, `assignedPlayerCount`, and `playersMissingHandicap` straight from its response using the **same, imported** `resolvePlayingHandicap()` helper — not a reimplementation.
- `deriveRoundWorkflow()` gained one new, **optional** input (`startReadiness`), so every existing caller/test is unaffected when it's omitted.
- When Stage 1 isn't ready, its detail line now shows the real blocking issue (e.g. *"Playing handicap missing for: Alex Schaefer, Daz."*) instead of the generic "Start when ready" — using the identical criteria the wizard's own submit already enforces, so this is a read-only preview, never a duplicate validation path.

10 new regression tests across `roundWorkflow.test.ts` (5) and the new `startRoundReadinessWiring.test.ts` (5).

---

## 8. Hard boundaries — confirmed untouched

None of this phase's work touched: core scoring calculations/verification rules, round-close RPCs/lifecycle semantics, Side Game winner calculations, Makers & Breakers candidate generation, slideshow deck-generation logic, database schema/migrations, or existing permissions/security controls. Every change in Sections 2–7 was presentation, labeling, position, or a read-only preview query — confirmed individually against this list before implementing. **The "stop and report" gate was never triggered.**

---

## 9. Files changed this phase

| File | Change |
|---|---|
| `src/lib/scoring/roundWorkflow.ts` | Stage 1 wording fix; new optional `startReadiness` input |
| `src/components/scoring/MakersBreakers.tsx` | React Query cache invalidation fix (the one confirmed defect) |
| `src/components/scoring/TournamentControl.tsx` | Removed redundant M&B button; moved Event Health to top; relabeled Event Story; relabeled/linked Group Map |
| `src/app/(app)/trips/[tripId]/memories/page.tsx` | Stage 5 deep link via `useSearchParams` + existing `chooseScope()` |
| `src/components/scoring/MyHQClient.tsx` | Review & Present routing to deep link; new setup-context query + wired Stage 1 readiness |
| `src/lib/scoring/makersBreakersStage4Fix.test.ts` | +2 tests (cache invalidation) |
| `src/lib/scoring/stage5SlideshowDeepLink.test.ts` | New, 5 tests |
| `src/lib/scoring/roundWorkflow.test.ts` | +5 tests (startReadiness wiring) |
| `src/lib/scoring/startRoundReadinessWiring.test.ts` | New, 5 tests |

No database migrations, no schema changes, no RPC changes.

## 10. Before / after organiser workflow

**Before Phase D:** two competing Makers & Breakers buttons on a completed round; Event Health buried mid-page, easy to miss; "The Story" ambiguous about scope; two things both called "Score Management"; Review & Present always opened the full picker even for a single just-closed round; Stage 1's tracker line never reflected real group/handicap readiness.

**After Phase D:** one obvious Makers & Breakers path (plus one genuinely contextual post-close nudge); Event Health visible immediately, expanded automatically when something needs attention; "Event Story" named for what it actually shows; one real Score Management tool with a clearly-labeled Group Map pointing to it; Review & Present jumps straight into the right scope (round or full event) automatically; Stage 1 tells the organiser exactly what's blocking the round from starting, using the same criteria the wizard itself will enforce.

## 11. Test results

- **826/826 tests passing** (`node --test` via the project's established `tsx`-loader convention — the same method used throughout this engagement; no live DB/network available in this sandbox).
- All 5 files changed this phase verified with zero `ts.transpileModule` diagnostics (a zero-dependency syntax check, not full type-checking — see Section 12).

## 12. TypeScript checking & production build — attempted, blocked by environment, honestly reported

Per your explicit instruction, I attempted to go beyond source-level tests and transpilation:

- `node_modules` was not present (fresh checkout, no lockfile-driven install yet).
- I ran `npm install` to get real `tsc`/`next build` checking with actual dependency types. **It is blocked**: the sandbox's egress proxy returned `403` for `registry.npmjs.org` — "the egress proxy denied the CONNECT (organization policy)". Per this environment's own troubleshooting guidance, a 403 from the proxy is an organization policy denial that should be reported, not retried or routed around.
- **I have not run, and cannot claim to have run, full TypeScript project-checking or a production build in this session.** Everything verified here is: (a) `ts.transpileModule` syntax-level checks (catches malformed syntax, not type errors against the real Next.js/Supabase/React types), and (b) the Node test-runner suite (826/826), which exercises pure functions and static-source assertions, not a live DB, not real HTTP, not a rendered browser.
- **This is the same limitation this whole engagement has had in this sandbox** — not new to Phase D, and not something I can resolve from inside this session. A real `tsc --noEmit` and `next build` should be run in an environment with dependency installation permitted (e.g. your own CI, or a local machine) before production deployment, exactly as you required.

## 13. Remaining limitations / deferred work

- No full TypeScript project check or production build was possible in this sandbox (Section 12) — required before deployment, not yet done.
- Real-device verification (the original P0 from your review) has not been performed by me — I audited the code against server-side behaviour and fixed what I found, but I have not operated the app on a physical phone.
- Hole setup (par/stroke index) is deliberately **not** included in the Stage 1 readiness preview — it's configured interactively inside the Begin Round wizard itself and isn't data My HQ already has on hand; previewing it would mean a new, speculative query, which your brief explicitly asked me to avoid.

## 14. Mobile verification checklist (for your walkthrough — not yet performed by me)

- [ ] Guided Workflow tracker: confirm Stage 1's detail line shows a real, accurate issue (e.g. missing handicap) on a round with incomplete groups, and "Start when ready" once groups/handicaps are complete.
- [ ] Makers & Breakers: Skip a round's review, confirm the tracker and `RoundHighlightsCard` update immediately (no stale 60s window) without a manual refresh. Repeat for Publish and Edit→republish.
- [ ] Switch between two rounds in the selector; confirm each round's tracker and highlights reflect only that round's own state.
- [ ] Event Health: confirm it now appears at the top of the page, and expands automatically when something needs attention.
- [ ] Score Management: confirm the Group Map table links correctly to the real Score Management panel lower on the page, and that panel's own functionality (overrides, reconciliation) is unaffected.
- [ ] Review & Present: from a single closed round (other rounds still open), confirm it opens the slideshow already scoped to that round. Once every round is closed, confirm it opens scoped to the full event.
- [ ] Confirm nothing above regresses existing Close Round button behaviour, Side Game winners, or any score the organiser has already entered.

## 15. Explicit deployment readiness assessment

**Not yet production-ready, by design** — matching your own stated gate ("hold production deployment until the real-device verification is complete").

What **is** done: the full source-level verification you asked for in Section 1 of your brief, one confirmed defect fixed, all five P1/P2 consolidation items completed and individually checked against the hard-boundaries list, 826/826 tests passing, and zero TypeScript syntax diagnostics across every changed file.

What is **not** done, and must happen before deployment: the real-device/mobile walkthrough (Section 14), and a full `tsc`/`next build` check in an environment where `npm install` is permitted (Section 12) — both outside what this sandbox can perform.
