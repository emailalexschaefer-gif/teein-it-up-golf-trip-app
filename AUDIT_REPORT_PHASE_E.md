# Teein' It Up — My HQ V2 Phase E — Technical Audit & Implementation Plan

**Status: audit only, per your explicit instruction. No code has been changed. Awaiting your approval before building anything described below.**

This covers the 10 points you asked for, plus the separate tied-winner finding you flagged. Everything here is based on direct reads of the actual source — file and line references throughout, not a reconstruction from memory of earlier phases.

---

## 1. Current My HQ component hierarchy

**`MyHQClient.tsx`** (the round-selection owner) renders, top to bottom:

1. `RoundSchedule` — Event Schedule / round selector (238–241)
2. `EventProgressBadge` — "N of M rounds closed" (249)
3. `RoundWorkflowTracker` — the five-stage tracker, for the **selected** round (250–259)
4. "Round Complete / Round ready" narration card — conditional (267–287)
5. "Event Complete" narration card — conditional (289–307)
6. `RoundHighlightsCard` (Makers & Breakers entry #1) — only when `selected.status === 'completed'`, inside `<div id="makers-breakers-section">` (313–317)
7. **`TournamentControl`** — the main dashboard (321)
8. `MyRoundSummary` ("My Round") — only if organiser is also playing, in a `CollapsibleSection` (330–332)
9. Empty state, when there are no rounds at all (338–357)

**`TournamentControl.tsx`** (1,251 lines), rendered per-selected-round, in order:

| # | Section | Lines | Wrapper | Own query? |
|---|---|---|---|---|
| 1 | Event Health | 495–530 | `CollapsibleSection` | reads parent's `data.health` |
| 2 | "ROUND — COMPLETE" / Round Snapshot button | 548–567 | plain div | — |
| 3 | Leaderboard Snapshot | 575–589 | plain div | — |
| 4 | Close Round button + confirm modal | 592–680 | plain div / modal | — |
| 5 | Round Summary header card (players/groups/scoring/%) | 683–702 | plain div | — |
| 6 | Group Progress | 705–781 | plain div, per-group manually expandable | — |
| 7 | Alerts | 784–848 | plain div + modals | — |
| 8 | Today's Highlights | 889–900 | plain div | — |
| 9 | Side Games | 907–933 | `CollapsibleSection` | `['side-games-snapshot', tripId, roundId]` (260) |
| 10 | `PlayingPartnerStatus` | 954 | plain (own card) | own internal `fetch`, not React Query |
| 11 | `RoundHighlightsSection` (Makers & Breakers entry #2) | 964 | plain (own card) | `['published-highlights', tripId, roundId]` — same cache entry as My HQ's own |
| 12 | Live Statistics | 970–1009 | `CollapsibleSection` | reads parent's `data.stats` |
| 13 | Group Map | 1027–1050 | `CollapsibleSection` | reads parent's `data.groups` (same data as #6) |
| 14 | Event Story | 1070–1072 | `CollapsibleSection` | own `['moments', tripId]` (unscoped) merged with parent's `data.story` |
| 15 | `EventMemoriesCard` | 1077 | plain (own card) | own `['memories-count', tripId]` (trip-wide, no roundId) |

Plus two off-flow branches: the post-close Round Snapshot screen and the post-close Makers & Breakers invitation (both pinned to a captured `closedRoundId`, not the live `roundId` prop — intentional, documented).

`TournamentControl`'s own top-level hooks: `['tournament', tripId, roundId]` (210), `['moments', tripId, roundId]` (238, labelled "The Story"), `['side-games-snapshot', tripId, roundId]` (259).

**Finding — dead query:** the `['moments', tripId, roundId]` query (238) feeds a `roundMomentsData` variable that is **never read anywhere else in the file** — its own render site ("The Story," a round-scoped duplicate of Event Story) was removed in an earlier pass, per the comment at 935–953, but the query itself was left behind. It fires on every mount and on every window-focus refetch, for a result nothing displays. Confirmed by grep — `roundMomentsData` appears exactly once in the file, at its own declaration. **Recommend deleting this query entirely as part of Phase E** — zero risk, no behaviour change, matches your own "avoid unnecessary network requests" standard from the Phase D brief.

**Score Management** (`AdminScoreOverridePanel`) is mounted **outside `MyHQClient` entirely**, directly in `src/app/(app)/trips/[tripId]/tournament/page.tsx` (203–211), under `<div id="score-management">`. It is not a card inside the dashboard at all today — it's a sibling at the page level, which is itself part of the round-inconsistency bug (Section 4 below).

**Guided Workflow tracker relative position:** `EventProgressBadge` and `RoundWorkflowTracker` are both siblings rendered directly above `TournamentControl`, not inside it, and not wrapped together with it.

---

## 2. Stage-by-stage content mapping

| Stage | Gets | From |
|---|---|---|
| **1 — Set Up & Start Round** | Group assignments, players, handicaps, tee times; existing Start Round control; readiness checklist | `setup-context` data already fetched in `MyHQClient` (Phase D); the Begin Round wizard's own group/player/handicap display (currently only reachable via the Rounds tab) |
| **2 — Manage Round** | Leaderboard Snapshot, Round Summary stats, Group Progress, Live Statistics, Side Games, Playing Partner Status, Group Map, Alerts, Score Management access | `TournamentControl` rows #3, #5, #6, #12, #9, #10, #13, #7 above, plus a link/anchor into `AdminScoreOverridePanel` |
| **3 — Close Round** | Scoring completion, reconciliation status, existing Close Round control, Final Round Snapshot, leaderboard access | `TournamentControl` rows #4, #2 above |
| **4 — Makers & Breakers** | Candidates, selection/review, Skip, Edit Selection, previously published highlights | `MakersBreakers` (already exists), consolidating `RoundHighlightsCard` + `RoundHighlightsSection` (currently two separate render sites) |
| **5 — Review & Present** | Create Round/Event Presentation, Round/Event Story, Event Memories gallery | `TournamentControl` row #14 (Event Story) + row #15 (`EventMemoriesCard`) + the existing Stage 5 deep link built in Phase D |

Event Health and "Today's Highlights" don't map cleanly into any single stage — see Section 7 for Event Health; "Today's Highlights" is genuinely Stage 2/3-adjacent (post-round, pre-close summary) and is the smallest, most dispensable section — recommend folding it into Stage 3's content as a short "Highlights" line rather than giving it its own subsection.

---

## 3. Redundant renderings to be removed once integrated

| Component | Current render sites | Keep / remove |
|---|---|---|
| Makers & Breakers | `RoundHighlightsCard` (MyHQClient #6) + `RoundHighlightsSection` (TournamentControl #11) + post-close invitation card (TournamentControl, off-flow) | Consolidate into Stage 4 only. The post-close invitation card is genuinely contextual (one-time, right after Close Round succeeds) — recommend keeping it, since it's not a competing *standing* entry point, consistent with your own "don't remove useful secondary navigation" principle from Phase D. |
| Group Progress / Group Map | Two separate renderings of the same `data.groups` (#6 full detail, #13 compact table) | Both move into Stage 2, but as one collapsible with the compact table as the default view and a "show full detail" toggle, rather than two separate cards — avoids showing the same group list twice on one page. |
| Event Story | One rendering (#14), already single | No duplication here; just relocates into Stage 5 under this plan. |
| Score Management label | "Group Map" (TournamentControl, cosmetic link only) vs. the real panel (`AdminScoreOverridePanel`, page-level) | Already disambiguated in Phase D (Group Map relabeled, links to the real anchor). Phase E's job is giving Stage 2 a genuine **entry point** into it, not just a text link at the bottom of the page. |
| `roundMomentsData` dead query | TournamentControl line 238 | Delete — see Section 1. |

**Not redundant, just currently mispositioned:** "ROUND — COMPLETE" card, Leaderboard Snapshot, Round Summary header, Alerts, Side Games, Live Statistics, Playing Partner Status — none of these exist twice; they each need exactly one new home inside a stage.

---

## 4. Round-selection inconsistency — root cause (this needed real investigation, not a guess)

This is **not** a single bug — it's **four independent "which round" decisions** that were never unified:

| Decision point | File:line | Picks round by |
|---|---|---|
| `focusRound` | `tournament/page.tsx:85` via `resolveFocusRound` (`multiRound.ts:463-467`) | `activeRound ?? mostRecentlyCompletedRound ?? nextUpcomingRound` — feeds `MyHQClient`'s `defaultRoundId` **once, at mount only** |
| `MyHQClient.selectedRoundId` | `MyHQClient.tsx:101` | `useState(defaultRoundId)`, then the organiser's own clicks in `RoundSchedule` |
| **`AdminScoreOverridePanel.selectedRoundId`** | `AdminScoreOverridePanel.tsx:41-43` | `rounds.find(r => r.status === 'active')?.id ?? [...rounds].sort((a,b) => b.play_date.localeCompare(a.play_date))[0]?.id ?? ''` |
| `memories/page.tsx filterRoundId` | `memories/page.tsx:40` | Always starts at `'all'` |

**The actual defect is #3.** Score Management resolves its own default round independently, using **`play_date` descending with no tiebreaker** — not the same `resolveFocusRound`/`sortRoundsChronologically` logic used everywhere else in this codebase, and not synced to whatever round the organiser has selected in My HQ. This exactly matches what you reported: "Score Management separately defaults to Round 1." It is wired to `page.tsx`'s own `rounds` prop, never to `MyHQClient`'s `selected`.

The Guided Workflow tracker and the statistics further down the page (your "Round 3 in the tracker, Round 2 in statistics" observation) **cannot structurally show two different rounds from each other** — they both read the exact same `selected`/`selectedRoundId` state, and `TournamentControl` takes `roundId` purely as a prop with no child independently re-resolving a round. The most likely explanation for what you saw is a **stale-render artifact**: `TournamentControl`'s own `['tournament', tripId, roundId]` query (line 210) has no `enabled` guard and no `placeholderData` isolation, so when `roundId` changes (a new round selected), React Query can briefly keep showing the *previous* round's cached data while the new query is in flight, before `isLoading`/the new data arrives — worth confirming on a real device whether this is a visible flash or genuinely sticks.

**Fix plan:** make Score Management take `roundId` as a prop from the same shared selection (`MyHQClient`'s `selected.id`), the same way every other child of `TournamentControl` already does, rather than resolving its own default. This also requires moving its mount point from `page.tsx` into the My HQ tree (which Stage 2's "Score Management access" sub-section gives it a natural home for). Separately, add an explicit `enabled`/placeholder strategy to the `['tournament', ...]` query so a round switch shows a loading state rather than a flash of stale data.

---

## 5. Keeping Stage 2 from becoming another long page

Stage 2 absorbs the single largest share of existing content (rows #3, #5, #6, #9, #10, #12, #13 above). Plan:

- Within Stage 2's expanded body, use **nested `CollapsibleSection`s** (it's already a generic, reusable component — nesting it is a direct, low-risk reuse, not new infrastructure) for Side Games, Live Statistics, and Group Progress/Map — each collapsed by default except the one most relevant to the round's current state (e.g. Alerts auto-expanded if any exist, mirroring Phase D's Event Health reactivity fix).
- Keep Leaderboard Snapshot and the Round Summary stat row **always visible, uncollapsed**, right at the top of Stage 2's body — these are the "what's happening right now" glance information; everything else is drill-down.
- Today's Highlights folds into a single line within the Leaderboard area rather than its own subsection (Section 2 above).
- Playing Partner Status stays always-visible but compact — it's usually short (a handful of rows) and operationally important (reconciliation blockers live here).

This keeps Stage 2's collapsed state to a handful of nested headers, and its expanded state to "glance info visible immediately, everything else one more tap away" — matching your own stated principle.

---

## 6. Lazy-loading candidates

Because `CollapsibleSection` only includes `children` in the reconciled tree once `expanded` is true, a component **mounted as a child of one** (Side Games' own section, Live Statistics, Group Map, Event Story) already doesn't run its own hooks/queries until expanded — this is "free" lazy loading already in place for anything moved into a nested `CollapsibleSection` under this plan.

**The exception, and the thing to fix:** `TournamentControl`'s own top-level `useQuery` calls (`['tournament', ...]`, `['moments', tripId, roundId]`, `['side-games-snapshot', ...]`) are hooks in `TournamentControl`'s own function body — they fire regardless of any `CollapsibleSection`'s collapsed state, because they're not inside a conditionally-rendered child. `['moments', tripId, roundId]` is the dead one to delete outright (Section 1). `['side-games-snapshot', ...]` is real data, but it's a prime candidate to **move the query itself down into a dedicated `SideGamesSection` child component**, so it only fires once that part of Stage 2 is actually expanded — genuine lazy loading, not just deferred rendering of already-fetched data.

`PlayingPartnerStatus` and `EventMemoriesCard` already each own their own fetch inside their own component files — moving them to be children of a `CollapsibleSection` (where not already) gets them the same free lazy-loading behaviour with no further code change.

---

## 7. Keeping Event Health immediately visible

Already solved structurally by the Phase D final-gate fix: `CollapsibleSection`'s `statusBadge` prop renders Event Health's summary (icon + text) in the **collapsed header itself**, and the element is keyed on the health bucket so a green→amber/red transition forces a re-expand even if the organiser had it collapsed. Phase E doesn't need to redo this — only to make sure Event Health keeps its current position "near the top of the upper organiser dashboard" as you specify, which the current structure (sibling, directly below the Guided Workflow tracker/Round Control Centre) already satisfies, and should stay outside the five-stage stepper entirely rather than being absorbed into Stage 2 — it's event-wide operational status, not round-setup content.

---

## 8. Reproducing the approved Event Snapshot design with dynamic data

**Important finding:** the approved reference image you attached is **not** the same artwork as the existing `event-at-a-glance-bg.jpg` asset already in the codebase (`public/images/`). I rendered the existing asset to compare directly — it has the Teein' It Up logo at the **top**, three thin gold divider lines, and the tagline **"This is how it unfolded"** at the bottom; your approved reference has the event title at the **top**, an "EVENT SNAPSHOT" heading, a visibly darker/more legible overlay, and the logo in the **bottom-right** alongside "RUN YOUR GOLF EVENT LIKE A PRO." These are two different compositions, not a copy problem.

The good news: the slide type that would carry this (`eventAtAGlance` in `slideshowDeck.ts`) already computes every number you asked for, live, from real event data — nothing here needs new business logic:
- Round count + course names: `data.rounds`, already summed (`slideshowDeck.ts:953-955`)
- Total holes: already summed from each round's own `holes` column (`:956`)
- Side Game count: `data.sideGameCount`, already computed (`:957`, sourced from `eventMemoryData.ts:377`)
- Event Champion count: `data.results.champion`, the exact same single source of truth the dedicated Champion slide uses (`determineChampions()` in `multiRound.ts`, via `computeFinalResults()` in `finalResults.ts`) — already correctly returns **every** tied player, not a forced single winner (see Section 10's related finding on the separate tied-winner bug — this path is already correct)
- The only field this slide doesn't currently carry that your reference image needs is the **event name itself** as a title — trivially available (`data.event.name`, already used by the `opening` slide builder) and additive to pass through, not new logic.

**What Phase E implementation would actually need:**
1. A new background artwork matching your approved composition, **without any baked-in event name or statistics** (per your own explicit instruction not to hardcode Schaefers Invitational/3 rounds/27 holes/5 side games/1 champion into a permanent background) — just the decorative framing (gradient darkening, "EVENT SNAPSHOT" heading, divider positions, logo, tagline, golf-ball/sunset photography).
2. Re-measuring column/divider positions against the **new** artwork (the existing renderer's divider percentages were measured from the old asset and do not carry over).
3. Adding `eventName` to the `eventAtAGlance` slide's data and rendering it as the dynamic title.
4. An accurate pending state for Event Champion when no champion is yet established (`championCount === 0` and the event isn't `completed` — currently `eventAtAGlance` only renders at all when `data.rounds.length > 0`, independent of event-completion status, so this needs an explicit "Pending" label path rather than showing "0").

This is entirely a **rendering/visual-layer change** (new asset + `EventHighlightsPlayer.tsx` JSX) — no change needed to `buildPresentationDeck()`'s slide-selection logic beyond passing one more already-available field through.

---

## 9. Slideshow renderers needing visual-only changes

| Change | Logic touched? | What actually changes |
|---|---|---|
| Opening slide date formatting | **No.** `formatDateRange()` (`slideshowDeck.ts:282-290`) is already the single source of truth, already used, already produces the exact format you specified (e.g. "October 5–7, 2026"). | Only the renderer's inline style for the date `<p>` (`EventHighlightsPlayer.tsx:619`) — currently `fontSize: clamp(12px,1.5vw,16px)`, color `#f0e6d2` with a text-shadow. Needs a larger size and/or stronger shadow/gradient for contrast. |
| Remove "Slide Show" suffix | **No.** Confirmed: the title already renders as just `{slide.eventName}` — there is no "Slide Show" suffix in code today (`EventHighlightsPlayer.tsx:618`). Nothing to remove; "Event Highlights" branding is already baked into the background artwork itself, not rendered dynamically. If you want a dynamic "Event Highlights" subtitle line in addition to what's baked into the art, that's a one-line JSX addition between the title and date. |
| Event Snapshot slide | **No**, beyond passing `eventName` through (Section 8). | New artwork + renderer repositioning. |
| Closing slide "My Golf" emphasis | **No change to deck-generation logic**, but **is** a real structural change to the renderer — worth flagging precisely: the entire closing slide today is a **static `<img>`** (`EventHighlightsPlayer.tsx:1054-1081`); "What a great event!", "Check out all your event memories and stats in MyGolf," and the tagline are **baked into the JPG itself**, not DOM text — confirmed by reading the actual renderer, there is no existing style to "just change." Two honest options: (a) a pure asset edit (no code change) regenerating the artwork with "My Golf" styled as requested, or (b) restructure the renderer the same way `opening`/`eventAtAGlance` already work — a background-image div with the text overlaid as real, styleable DOM `<p>`/`<span>` elements. Option (b) is more maintainable going forward (the wording becomes editable without regenerating art) and is the better fit with the rest of this deck's pattern, but it is the one genuinely non-trivial renderer change in Part B. |

---

## 10. Risks to existing scoring or event operations

- **None of Sections 1–9 touch scoring, round-close RPCs, handicaps, Side Game winner calculations, Makers & Breakers candidate generation, deck-generation business logic, schema, or permissions.** Every change identified is presentation, position, or passing an already-computed value one level further through.
- **The one genuine structural risk:** `RoundWorkflowTracker.tsx` today has **no expand/collapse state and no content slots at all** — it's a pure stepper whose buttons currently navigate away (Rounds tab) or scroll to an anchor elsewhere in `TournamentControl`. "Make all five stages expandable" with embedded content is a real rework of this component's API (needs per-stage body content and its own expanded-stage state, replacing "navigate elsewhere" with "expand in place" for at least Stages 1, 2, 4, 5 — Stage 3 already has a real control that would need relocating in, not just linking to). This is the single largest piece of net-new structural work in this phase, not a reuse-and-reposition job like the rest.
- **Score Management's move** (Section 4) changes where `AdminScoreOverridePanel` is mounted (from `page.tsx` into the My HQ tree) and how its round is selected (from its own independent default to the shared `selected.id`) — flagged per your own gate as a structural change worth your explicit sign-off before building, even though it changes no scoring/permission logic itself, only which round the panel opens to by default.
- **Everything else is additive or repositioning** — existing components move, existing queries get reused or relocated, nothing is rebuilt from scratch.

---

## Separate finding: the tied-winner "wins by 0" bug — investigated, not fixed

Confirmed, found the exact line. `src/app/api/trips/[tripId]/rounds/[roundId]/tournament/route.ts:679-683` ("Today's Highlights"):

```ts
const winner = ranked[0]
const runnerUp = ranked[1]
if (runnerUp) highlights.push(`🏆 ${winner.name} wins by ${winner.totalPts - runnerUp.totalPts} Stableford point${winner.totalPts - runnerUp.totalPts === 1 ? '' : 's'}`)
```

`ranked` is sorted `totalPts` desc, `holesPlayed` desc as a **display-ordering tiebreaker only** (line 256) — not an official countback method. When two players are genuinely tied on points, `winner.totalPts - runnerUp.totalPts === 0`, producing exactly what you saw: "Alex Schaefer wins by 0 Stableford points."

**This is the same bug class the codebase already fixed once, elsewhere** — `src/lib/highlights/makersBreakers.ts`'s `findMailman()` (315–345) had the identical "win by 0" problem and was fixed on 14 Sep with an explicit three-way split: a genuine positive margin says "won by N," a true tie says **"tied for the lead,"** and no margin at all says "the round win" — with the code's own comment noting this was a **copy fix, not a scoring change**, since the underlying winner-selection ordering was never wrong, only the sentence describing it. That fix was never applied to this second, separate call site.

**Proposed fix** (not applied — flagging for your approval alongside everything else here, since it touches result-announcement text): mirror the exact same three-way pattern in `tournament/route.ts`'s highlight line — margin > 0 → "wins by N," margin === 0 → a tie-worded line (e.g. "🤝 [names] tied at the top with N points"), no runner-up → "wins" unchanged. This is copy-only; `ranked`'s own ordering and the authoritative champion-determination path (`determineChampions()`, confirmed correct and already tie-safe in Section 8) are untouched.

---

## Summary — what I'm asking you to approve

1. The five-stage content mapping in Section 2, including relocating Score Management into Stage 2.
2. Deleting the dead `roundMomentsData` query (Section 1) — zero-risk cleanup.
3. Reworking `RoundWorkflowTracker` to support per-stage expand/collapse with embedded content (Section 10's flagged structural change).
4. Fixing Score Management's round-selection default to follow the shared selected round (Section 4).
5. The Event Snapshot slide needing a new background asset (not a reuse of the existing one) plus the small `eventName` data addition (Section 8).
6. The closing-slide restructure from static image to overlaid dynamic text for "My Golf" (Section 9).
7. The separate tied-winner copy fix (mirroring the existing Mailman pattern).

I haven't built any of this — awaiting your go-ahead, or any adjustments, before starting.
