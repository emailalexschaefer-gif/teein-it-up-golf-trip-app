# TEEIN' IT UP — MY HQ V2, PHASE C
## Delivery report — 10 Oct 2026

Phases A and B were delivered and approved earlier today
(`AUDIT_REPORT_MY_HQ_V2_PHASE_A_2026-10-10.md`,
`MY_HQ_V2_PHASE_B_WORKFLOW_MAPPING_2026-10-10.md`). This report covers
Phase C: the actual build, against your "Proceed to Phase C" approval
and its three refinements.

## 1. What shipped

### 1.1 The five-stage derivation (`src/lib/scoring/roundWorkflow.ts`, new)

A single pure function, `deriveRoundWorkflow()`, exactly matching the
approved Phase B table plus all three refinements:

- **Refinement 1 (Stage 3 stays visible):** Close Round is `reached`
  the moment a round goes active — long before it's actually ready —
  and shows a distinct "Waiting for scoring" / "Waiting for
  reconciliation" line throughout live play. It only becomes the
  primary action once the existing Close Round button's own condition
  (`completionPct === 100 && awaitingReconciliation === 0`) is met —
  reused verbatim via a `readyToClose` input, never recalculated.
- **Refinement 2 (Stage 4 stays revisitable):** "complete" is driven
  purely by `publishedAt !== null` (regardless of array length) and is
  never a locked state — the UI still renders a "Review again" link on
  a complete Stage 4.
- **Refinement 3 (Stage 5 never competes as a second primary):** the
  primary-action search walks stages in fixed order (Start → Close →
  Makers & Breakers → Review & Present, Manage Round excluded since it
  has no button of its own) and stops at the first one that's
  actionable and incomplete. Stage 5 is independently `actionable`
  (always, once closed) but is only ever chosen as primary once Stage
  4 is complete.

A second pure function, `deriveEventProgress()`, computes "N of M
rounds closed" from `rounds.filter(r => r.status === 'completed')` —
completely independent of every round's own Stage 4/5 status, per
point 2 of your approval.

A third helper, `deriveStartRoundReadiness()`, mirrors the start
route's own existing validation (groups exist, players assigned,
every assigned player has a resolvable handicap) as a read-only
preview. **Honest scope note:** this helper exists but isn't wired
into My HQ's UI yet — see §5 (Deferred).

**35 new tests** cover every lifecycle transition, both empty-review
persistence cases, the primary-action priority ordering (including
the Stage 4/5 simultaneous-current-but-single-primary case), and
multi-round independence.

### 1.2 Stage 4 fix — the empty-review persistence gap

Per your approved no-migration convention:

- **`RoundHighlightsSection.tsx`** — the collapsing bug
  (`!publishedAt || highlights.length === 0`) is fixed. It now hides
  only when there's genuinely no row (`!publishedAt`), and renders a
  distinct "Reviewed — no highlights selected" line when a row exists
  with an empty array.
- **`MakersBreakers.tsx`** — two new organiser actions:
  - **Skip** ("Skip — don't select any highlights for this round"),
    available on the curating screen regardless of candidate count —
    this is also the fix for the genuine empty-candidates case, which
    can no longer permanently block Stage 4. Publishes `highlights: []`
    explicitly; only transitions to the published view on confirmed
    server success (a failure shows the same inline error the normal
    publish path already uses, and leaves the organiser exactly where
    they were).
  - **Edit Selection**, on the published view — re-fetches the same
    candidate set, pre-selects whatever is currently published (never
    starts from a blank slate), and drops back into the ordinary
    curating flow. Saving from there goes through the exact same
    publish()/upsert path as a first-time review.
  - Nothing writes on mere page-load: confirmed by a regression test
    asserting there's exactly one `POST` call site in the whole file
    (inside `doPublish()`), and that the mount effect only ever reads.
  - The one call site that mounts this component
    (`TournamentControl.tsx`) needed no changes — same props,
    same signature.

**9 new tests**, all passing (static source-level, matching this
project's existing convention for client components with no
DOM/React test harness set up — see
`messagesNullablePlayerIdFix.test.ts` for precedent).

### 1.3 The Guided Workflow UI (new components)

- **`RoundWorkflowTracker.tsx`** — the compact vertical stepper beneath
  Event Schedule, per "a compact vertical stepper... is preferred over
  a crowded five-column navigation bar." Pure presentational: takes
  the already-derived `stages`/`primaryStageId`, renders green/gold/
  grey/amber/muted-outline per the approved visual language, and never
  shows colour as the only signal (every state also has a distinct
  text badge: Complete / Current / In progress / Waiting / Available /
  Upcoming). Delegates every click to the caller via `onAction` — it
  owns no mutation logic itself.
- **`EventProgressBadge.tsx`** — "Event Progress: N of M rounds
  closed" / "Event Complete," fed only by `deriveEventProgress()`.

**7 new tests** (source-level, same convention) confirming the
tracker never reads `round.status` directly, never calls `fetch`
itself, and always renders exactly one primary CTA at a time.

### 1.4 Wiring into My HQ (`MyHQClient.tsx`)

- Two new small `useQuery` calls, using the **identical query keys**
  TournamentControl (`['tournament', tripId, roundId]`) and
  MakersBreakers/RoundHighlightsSection
  (`['published-highlights', tripId, roundId]`) already use — React
  Query shares one cache entry per key across every component under
  the same provider, so this never doubles real network traffic once
  either side is warm, and never recomputes round status or
  reconciliation independently.
- `EventProgressBadge` and `RoundWorkflowTracker` now render directly
  beneath Event Schedule, exactly matching the approved page hierarchy
  (Event Schedule → Guided Workflow → ...).
- `onAction` routes each stage's button to the **existing** control
  that already performs it — no parallel start/close/review flow:
  - Start Round → `/trips/{tripId}?tab=rounds` (the same "Go to
    Rounds" target this file already used for its empty state).
  - Close Round → scrolls to a new, always-rendered, purely-cosmetic
    anchor (`id="close-round-section"`) added to `TournamentControl.tsx`
    just above its existing Leaderboard Snapshot/Close Round block, so
    it's a valid scroll target whether or not the round is actually
    ready to close yet.
  - Select/Review Makers & Breakers → scrolls to a new wrapper div
    (`id="makers-breakers-section"`) around the existing
    `RoundHighlightsCard` entry point in `MyHQClient.tsx` — the entry
    point itself is unchanged.
  - Review & Present → `/trips/{tripId}/memories` (the existing
    Memories page). See §5 for the scope-preset deep link this
    doesn't yet include.

### 1.5 `PlayerHomeCard.tsx` chronology fix (per point 7 of your approval)

Two call sites in the player-facing Lobby view still had the exact
un-tiebroken `sort((a, b) => a.play_date.localeCompare(b.play_date))`
pattern that caused the original Round 2/Round 3 bug (fixed everywhere
else on 28 Aug). Both now use the canonical
`sortRoundsChronologically()` helper from `multiRound.ts`:

- The "most relevant round" focus logic (feeding `resolveFocusRound`).
- The plain "Rounds" display list further down the same page.

**4 new tests**, including a behavioural one confirming two rounds
sharing both `play_date` and `created_at` (the exact Postgres
batch-insert tie condition that caused the original bug) still resolve
deterministically.

## 2. Files changed

| File | Change |
|---|---|
| `src/lib/scoring/roundWorkflow.ts` | **New.** `deriveRoundWorkflow`, `deriveEventProgress`, `deriveStartRoundReadiness`. |
| `src/lib/scoring/roundWorkflow.test.ts` | **New.** 35 tests. |
| `src/components/scoring/RoundHighlightsSection.tsx` | Fixed the publishedAt-vs-empty-array collapsing bug. |
| `src/components/scoring/MakersBreakers.tsx` | Added Skip and Edit Selection actions; refactored publish into a shared `doPublish()`. |
| `src/lib/scoring/makersBreakersStage4Fix.test.ts` | **New.** 9 tests. |
| `src/components/scoring/RoundWorkflowTracker.tsx` | **New.** The five-stage progress UI. |
| `src/components/scoring/EventProgressBadge.tsx` | **New.** "N of M rounds closed." |
| `src/components/scoring/roundWorkflowTracker.sourceCheck.test.ts` | **New.** 7 tests. |
| `src/components/scoring/MyHQClient.tsx` | Wired the tracker + badge; added `onAction` routing; two new read-only queries. |
| `src/components/scoring/TournamentControl.tsx` | Added one cosmetic scroll-target `id`; no logic changes. |
| `src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx` | Fixed both un-tiebroken chronology sort sites. |
| `src/lib/scoring/playerHomeCardChronologyFix.test.ts` | **New.** 4 tests. |

**55 new tests across 5 new test files.** Nothing was removed or
loosened in any existing test.

## 3. Verification

- Every new/changed file passes a zero-diagnostic
  `ts.transpileModule` syntax check (strict JSX included).
- Full suite: **809 / 809 passing** (754 baseline at the start of this
  session → 809 now, +55 from this work). Nothing regressed.
- This is sandbox verification only (no `node_modules`, no live
  Supabase/network access in this environment) — **not** a live-device
  confirmation. Before this goes in front of Darren's event, the
  mobile walkthrough in §4 below should be run on a real device.

## 4. What still needs a real-device pass

1. Open My HQ on a round that's upcoming, active-but-not-ready,
   active-and-ready-to-close, completed-and-not-reviewed, and
   completed-and-reviewed — confirm the tracker shows the right single
   primary action each time, with Stage 3's "Waiting" text visible
   throughout live play and never looking skipped.
2. Finish a round's Makers & Breakers review with the **Skip** action
   when there genuinely are candidates, and separately on a round with
   zero generated candidates — confirm it never gets stuck.
3. Re-open a finished review via **Edit Selection**, change the
   selection, save — confirm the new selection persists and the old
   one isn't silently restored on refresh.
4. Tap each workflow action on a phone in portrait — confirm the
   scroll targets land in the right place and nothing is clipped by
   the bottom nav.
5. Confirm the two new My HQ queries don't visibly double-fetch
   (network tab) once TournamentControl has also mounted.

## 5. Deferred — not done in this pass, reported rather than guessed at

Given the scope of this release, the following Phase D items from
your original brief were **not** attempted this pass, to keep the
change surface reviewable and avoid regressing working code under time
pressure. None of these were silently dropped — flagging them now so
you can decide priority for a follow-up pass:

- **Full de-duplication of the four Makers & Breakers entry points**
  (the audit's §1 finding) — the Guided Workflow tracker now gives a
  fifth, clearly-primary way in, but the three pre-existing entry
  points (the "Round Complete" card's own button, the post-close
  invitation card, `RoundHighlightsCard`) still all exist unchanged.
- **Event Health repositioning** — still mid-page in
  `TournamentControl.tsx`, not moved near the top.
- **"The Story" scope relabeling** (Round Story vs Event Story) — not
  touched.
- **Score Management consolidation** (the two same-labeled
  components) — not touched.
- **Stage 5's scope-preset deep link** — "Review & Present" currently
  routes to the plain Memories page rather than
  `?startSlideshow=round&roundId=X` jumping straight into a pre-scoped
  slideshow builder. Implementing that needs reading the slideshow
  builder's own config component in detail first, which this pass
  didn't do — building it without that context risked guessing at an
  unfamiliar component's internals.
- **Stage 1's readiness checklist in the UI** — `deriveStartRoundReadiness()`
  exists and is tested, but isn't fetching real group/handicap data
  into My HQ yet; Start Round's button currently just routes to the
  Rounds tab where the existing wizard performs its own validation.

None of these touch a hard boundary (scoring, round-close RPCs, Side
Game winners, the slideshow's own deck generation, or the schema) —
they're presentation/consolidation work explicitly safe to pick up
next, whenever you'd like.
