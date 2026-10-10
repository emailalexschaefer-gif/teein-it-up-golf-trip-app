# Teein' It Up — My HQ V2 — Final Pre-Production Verification Gate

**Phase D's feature scope is frozen, per your instruction — this pass made no redesign or new feature changes.** It performed the five checks your gate specified: three targeted code-level verifications (one of which found and fixed a genuine, reachable defect), the build verification attempt, and the mobile acceptance checklist.

**Full test suite: 842/842 passing** (826 before this pass, +16 new regression tests).
**TypeScript syntax check: 0 diagnostics** across all 5 files touched this pass.
**Build verification: still blocked by organization policy — see Section 4. This is the one gate that remains un-closed from this sandbox.**

---

## 1. Event Health reactivity — defect found and fixed

**Your concern:** `defaultExpanded={data.health.level !== 'green'}` may only set the initial expansion state, and a green→amber/red change while mounted might stay collapsed.

**Confirmed, by reading `CollapsibleSection.tsx` directly:** `expanded` is a plain `const [expanded, setExpanded] = useState(defaultExpanded)`. React only consults a `useState` initializer on the component's first mount — a later change to the `defaultExpanded` prop is never re-read. And this is a reachable, not theoretical, problem: `TournamentControl.tsx`'s own tournament-data query (which computes `data.health`) polls every 8 seconds while a round is active (`refetchInterval: roundStatus === 'active' ? 8000 : false`). So a genuine green→gold/red transition (e.g. a new marker mismatch appearing mid-round) while the organiser has this section collapsed would previously never auto-expand — they could miss it entirely.

**Fix:** keyed the `CollapsibleSection` element on the health *bucket* (`data.health.level !== 'green' ? 'health-warn' : 'health-ok'`), not the raw level. React remounts the element — re-seeding `expanded` fresh from `defaultExpanded` — only on an actual green↔non-green transition. A gold↔red fluctuation (same bucket) never forces a needless remount, and an organiser who deliberately re-collapses the section while the issue is still the same severity isn't fought on every poll. The section's content is pure props-derived JSX with no state of its own, so the remount loses nothing.

**No change to how health is calculated** — position, labeling and calculation from the earlier Phase D pass are untouched; only the expansion-reactivity bug is fixed.

2 new regression tests in `finalPreProductionGate.test.ts`.

## 2. Slideshow deep link — one real defect found and fixed (URL not cleaned up after consumption)

Walked through each scenario you named:

| Scenario | Result |
|---|---|
| Direct page load (bookmarked/typed URL, no My HQ referrer) | **Already correct.** The effect is driven purely by `searchParams`, not by any "came from My HQ" signal — it fires the moment a recognised param and a loaded manifest are both present, regardless of how the page was reached. |
| Manifest still loading | **Already correct.** The effect's own guard (`if (deepLinkHandled \|\| !manifest) return`) means it runs and immediately no-ops on every render until the manifest arrives, then proceeds exactly once. |
| Invalid/unmatched round id | **Already correct** (built and tested in the earlier Phase D pass) — `roundExists` is checked against the loaded manifest before calling `chooseScope`; an invalid id still gets marked "handled" and falls through to the ordinary picker, never an error state or a retry loop. |
| Closing the slideshow and returning, within the same page visit | **Already correct.** The effect's dependency array is exactly `[manifest, deepLinkHandled]` — closing the slideshow only changes `slideshowStep`, which this effect doesn't depend on, so it cannot re-fire. |
| **A later page refresh, or the PWA restoring this exact browser tab** | **Defect found.** The query params were never removed from the URL. On a fresh mount (refresh / restored tab), `deepLinkHandled` resets to `false` and the effect runs again from scratch — silently re-launching the slideshow every single time that URL is revisited, not a one-time deep link at all. |

**Fix:** the moment the deep link is consumed (whether it goes on to open the slideshow or safely falls through on an invalid round), it now calls `router.replace(pathname, { scroll: false })` to strip `startSlideshow`/`roundId` from the URL — `replace`, not `push`, so this cleanup never adds its own back-button entry, and `scroll: false` so it doesn't jump the page. The slideshow's own in-memory state is untouched; only the address bar is cleaned up.

**Deck generation, `buildPresentationDeck`, `getAvailableSections` — confirmed untouched**, same as the original Phase D pass.

5 new regression tests in `finalPreProductionGate.test.ts` (plus the 5 pre-existing ones in `stage5SlideshowDeepLink.test.ts`, re-verified passing after this change).

## 3. Start Round readiness — defect found and fixed (loading/error could look like "ready")

**Your concern:** the readiness preview must distinguish an actual setup blocker from a failed or loading query; a network error must never look like confirmation that the round is ready.

**Confirmed:** the previous wiring was `const startReadiness = setupContextData ? deriveStartRoundReadiness(...) : null`, and Stage 1's detail text fell back to the generic **"Start when ready"** whenever `startReadiness` was `null` — which covered both "still loading" and "the fetch failed" exactly as it covered "there's nothing to check yet." A slow network or a failed request would show the organiser the same reassuring wording as a genuinely ready round.

**Fix:** the setup-context query's own `isLoading`/`isError` flags are now threaded through (gated the same way the query itself is `enabled` — upcoming round only) into two new, optional `deriveRoundWorkflow` inputs: `startReadinessLoading` and `startReadinessError`. Stage 1's detail text now checks these **before** consulting `startReadiness` at all:

- loading → **"Checking round readiness…"**
- fetch failed → **"Could not check round readiness — open Start Round to review setup"**
- resolved, not ready → the real blocking issue (unchanged from the earlier pass)
- resolved, ready → **"Start when ready"** (unchanged)

None of this changes whether Stage 1 is `complete`/`actionable`/the primary action, and none of it gates the actual Start Round button — **the Begin Round wizard remains the sole authoritative validator**, exactly as you required; this is still a read-only preview that can now fail honestly instead of failing silently-optimistic.

9 new regression tests (4 pure-function tests in `roundWorkflow.test.ts`, covering loading-takes-priority-over-stale-data and the active/complete/primary-stage non-interference cases; the rest source-level wiring tests in `finalPreProductionGate.test.ts`).

## 4. Build verification — attempted, still blocked by organization policy

Re-attempted exactly as instructed, in a fresh attempt (not a bare retry of the earlier-reported failure):

```
$ npm install --no-audit --no-fund
```
Hung with no output and no proxy error for the full timeout — matches this environment's own documented "tool ignores the proxy entirely" failure class for a plain DNS-first resolution attempt.

Isolated the exact cause by going around npm's own retry/backoff and hitting the registry directly through the egress proxy:

```
$ curl -sS --proxy http://127.0.0.1:<proxy-port> \
    -o /dev/null -w "HTTP_CODE:%{http_code}\n" \
    https://registry.npmjs.org/next
```
```
curl: (56) CONNECT tunnel failed, response 403
[agent-proxy] registry.npmjs.org:443 — connect_rejected
  (the egress proxy denied the CONNECT — organization policy)
```

This reproduced identically on a second attempt after the proxy's own port was reassigned mid-session (an unrelated environment restart), confirming it's a stable policy decision, not a transient blip. Per this sandbox's own troubleshooting guidance: *"403/407 from the proxy… Do not retry or route around it — report the blocked host."* I'm reporting it rather than continuing to retry or attempting a workaround.

**Consequence, stated plainly:** `node_modules` cannot be installed in this sandbox, so neither `tsc --noEmit` (with real Next.js/React/Supabase types) nor `next build` could be run here. Everything in this delivery — and in the Phase D delivery before it — is verified by:
1. `ts.transpileModule` on every changed file (a zero-dependency **syntax**-level check — it would catch a malformed statement, but not a type error against the real library types), and
2. the project's Node test suite (842/842) — pure-function and static-source-text assertions, not a rendered browser, not a live DB, not real HTTP.

**This is not a new limitation introduced by this pass** — it's the same sandbox constraint this whole engagement has had. It needs to be resolved in an environment where `npm install` is permitted (your own CI, or your local machine) before this is genuinely production-ready. I have not run, and am not claiming to have run, a full TypeScript project check or a production build.

## 5. Deployment handoff

### Files changed this pass

| File | Change |
|---|---|
| `src/components/scoring/TournamentControl.tsx` | Event Health `CollapsibleSection` now keyed on the health bucket (reactivity fix) |
| `src/app/(app)/trips/[tripId]/memories/page.tsx` | Deep link now strips its own query params via `router.replace` once consumed |
| `src/components/scoring/MyHQClient.tsx` | Setup-context query's loading/error state threaded through to the workflow derivation |
| `src/lib/scoring/roundWorkflow.ts` | Two new optional inputs (`startReadinessLoading`, `startReadinessError`); Stage 1 detail text now checks them first |
| `src/lib/scoring/roundWorkflow.test.ts` | +9 tests |
| `src/lib/scoring/stage5SlideshowDeepLink.test.ts` | 1 regex updated for the new import line (no behaviour change to the test's intent) |
| `src/lib/scoring/startRoundReadinessWiring.test.ts` | 1 regex updated for the two new fields threaded alongside `startReadiness` |
| `src/lib/scoring/finalPreProductionGate.test.ts` | New file, 11 tests covering all three code-level items above |

No database migrations, no schema changes, no RPC changes, no scoring/Side Game/slideshow-deck-generation logic touched — consistent with your explicit boundary.

### Deployment candidate status

| Gate | Status |
|---|---|
| 826 (now 842) automated tests passing | ✅ Done |
| Phase D consolidation completed | ✅ Done (prior delivery) |
| Final verification items 1–3 (this pass) | ✅ Done — one real defect fixed in each |
| Full TypeScript check | ❌ **Blocked** — `npm install` denied by organization policy in this sandbox (Section 4) |
| Production build | ❌ **Blocked** — same cause |
| Mobile organiser walkthrough | ⬜ **Not yet performed** — checklist below is for you to run |
| Live scoring and close-round smoke test | ⬜ **Not yet performed** — included in the checklist below |

**I am not declaring production readiness.** Two of your six gates are genuinely outside what this sandbox can close. Everything that could be verified from source — the three targeted items, the full regression suite, syntax-level correctness — is done and passing.

## 6. Mobile acceptance checklist

Organised by the event-lifecycle states you asked for.

**Upcoming round**
- [ ] Guided Workflow Stage 1 shows **"Checking round readiness…"** briefly on load, then either **"Start when ready"** or a specific missing-setup issue (e.g. a named player's missing handicap) — never a blank or stuck "checking" state.
- [ ] Turn off mobile data/Wi-Fi briefly while this loads; confirm Stage 1 shows **"Could not check round readiness…"**, not "Start when ready."
- [ ] Tap Start Round from the tracker; confirm it opens the Rounds tab, and that the Begin Round wizard's own validation (not My HQ's preview) is what actually blocks starting an incomplete round.

**Active round**
- [ ] With a round live, deliberately create a marker/self-score mismatch on one hole; confirm Event Health flips from green and the section **auto-expands** even if you'd previously collapsed it while green.
- [ ] Resolve the mismatch; confirm Event Health can return to green (and collapses back to default) without needing a manual refresh.
- [ ] Confirm the live leaderboard/completion numbers continue updating every ~8s as before (no change expected, but worth a glance since this pass touched the same query's consumers).

**Closed round (reviewed and not-yet-reviewed)**
- [ ] On a just-closed, not-yet-reviewed round: confirm exactly one obvious Makers & Breakers entry point from the tracker (the old duplicate button should not reappear).
- [ ] Skip the review with zero highlights selected; confirm the tracker immediately shows "Reviewed — no highlights selected" with no stale delay. Repeat for Publish, then Edit → republish.
- [ ] From My HQ, tap Review & Present on this single round (other rounds still open); confirm the Memories page opens **already scoped to this round**, and that doing a manual refresh on that page afterward does **not** relaunch the slideshow automatically.
- [ ] Use the browser/app back button after the slideshow opens from the deep link; confirm it returns to My HQ (not a loop back into the slideshow).

**Multi-round event, fully closed**
- [ ] With every round closed, tap Review & Present; confirm it opens the full-event-scoped slideshow, not a single round.
- [ ] Switch between two different rounds in the round selector; confirm each one's tracker, Event Health, and highlights reflect only that round — no bleed-through from the previously selected round.

**Paper-player scoring & reconciliation**
- [ ] On a round with at least one paper scorecard, create an intentional self/marker mismatch; confirm it surfaces in Event Health and that Close Round is correctly blocked until completion (100%) regardless of whether that specific mismatch is reconciled — this is existing, intentional behaviour (the UI's Close gate is stricter than the bare server requirement; confirmed in the prior Phase D pass, not changed here).
- [ ] Confirm the Score Management / Group Map relabeling didn't affect the organiser's ability to override a paper score or run reconciliation from the real Score Management panel.

### Final note

Across Phases A–D plus this verification pass, the organiser journey you described — prepare, start/manage, close, celebrate, present — is implemented and internally consistent, with the three things you specifically asked be checked each found and fixed a real (if narrow) issue rather than a false alarm. The feature work is done. What's left is exactly what you said it would be: watching an organiser run it on their phone, and a build check this sandbox can't perform. Both are yours to run next.
