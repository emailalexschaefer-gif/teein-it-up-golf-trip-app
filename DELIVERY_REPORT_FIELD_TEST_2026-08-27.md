# POST-DAVE FIELD TEST + LAST-TWO-RELEASE REGRESSION BUNDLE
## Delivery Report — 2026-08-27

**Build/test caveat, upfront and unchanged from every prior round:**
this sandbox has no network access (`npm install` returns 403), so
`npm run build` and a real `tsc --noEmit` against the project's actual
dependencies could **not** be run. Every file touched or reviewed this
round was syntax-checked directly with the TypeScript compiler's parser
(zero errors across all 10 files touched). This is not a substitute for
a real build — **run `npm run build` before this ships**, per the
standing rule. The 224 pure-function tests under `src/lib/scoring/**`
all pass unchanged; no business-logic file was modified this round.

Per the explicit instruction, I inspected the current code before
changing anything, and left working architecture alone wherever it
already passed inspection — see Part B below for what was verified
rather than touched.

---

## PART A — NEW BUGS

### 1. Swipe navigation broken
**Reproduced:** yes, by code inspection (see root cause).
**Root cause:** my own regression from an earlier round. The
`onTouchStart`/`onTouchEnd` handlers were attached to
`scrollContainerRef`, which — since the shared-device fix that split
Marnie's horizontal scorecard out to sit above her own scoring panel —
only wraps the small collapsed scorecard-toggle strip at the very top
of the page. The actual scoring cards, banners, and everything else a
person would naturally swipe on became siblings outside that div, so
touches there never reached the handlers.
**Fix:** moved the handlers to the true outermost page wrapper
(`scoring-workspace-outer`), which genuinely contains the whole
scrollable page. Same `onTouchStart`/`onTouchEnd` functions, same
`setHoleIdx` calls the Previous/Next buttons already use — no second
navigation mechanism.
**Files:** `SelfMarkerScoreShell.tsx`

### 2. Outdoor scoring-screen readability/contrast
**Reproduced:** not independently (no way to test outdoor glare from
this sandbox) — treated as reported.
**Root cause:** several specific colors on the scoring screen were pale
tans/grays with weak contrast against the white/cream background —
card borders, +/- buttons, Pick Up, PAR/SHOTS/TOTAL, the hole
number/distance/par/SI header, Playing Handicap, and the horizontal
scorecard tiles' borders and secondary text.
**Fix:** darkened each of those specific values (e.g. card border
`#d9d4c7` → `#a89f8a`, +/- button border `#c9c2b2` → `#8a8270`, hole
number `#a1791f` → `#7a5c00`, distance/par/SI `#8a6d3f` → `#5c4425`,
Previous/Next Hole border `#d1d5db` → `#8a8f96`) — same light design,
same white background, no redesign. Enabled/disabled distinction on
buttons was deliberately left alone (that contrast drop is the
affordance).
**Files:** `SelfMarkerScoreShell.tsx`, `ExpandableRoundScorecard.tsx`

### 3. Live Leaderboard name truncation
**Reproduced:** yes, by code inspection.
**Root cause:** `MultiRoundRow` (the 2+ round leaderboard view) still
had `textOverflow: 'ellipsis'` on the name column. A comment in that
exact spot described a fix ("Round-column width trimmed 52 → 44") as
already done, but the code still had the columns at 52 and the
ellipsis truncation both in place — the described fix had never
actually landed.
**Fix:** Previous/Current columns reduced 52px → 44px to reclaim room,
and the name switched from single-line ellipsis truncation to
word-level wrapping (never mid-word — that was the *original* bug this
replaced, historically) up to two lines. Most names still render on one
line exactly as before; only genuinely long names now wrap instead of
truncating. Previous/Current/Total are all preserved, nothing removed.
**Files:** `LiveLeaderboard.tsx`

### 4. My HQ — completed-round information disappears
**Reproduced:** yes, by code inspection.
**Root cause:** `TournamentControl` (the detailed dashboard) was only
ever rendered when `activeRound` existed server-side, hardcoded to that
one round's id. The moment Round 1 completed and Round 2 was still
`upcoming` (not yet `active`), the entire dashboard was replaced by a
small "Round 1 Complete" CTA card with no way back to Round 1's data.
`RoundSchedule`'s Event Schedule cards were also rendered with
`interactive={false}`, because the page is a Server Component and can't
pass a real `onSelect` handler across that boundary.
**Fix:** built `MyHQClient.tsx`, a client component following the exact
pattern already proven correct for the player-facing equivalent
(`MyRoundClient.tsx` + `PlayerRoundView`, which never had this bug). It
holds `selectedRoundId` state, renders `RoundSchedule` with a real
`onSelect`, and renders `TournamentControl` for whichever round is
**selected** — not whichever happens to be `active`.
`TournamentControl` itself already correctly handles
`roundStatus === 'completed'` (gating the Close Round button/polling),
so no changes were needed there — it simply had never been given the
choice of which round to show. The "Round 1 Complete / Round 2 ready"
and "Event Complete" messages are preserved, now rendering
*additionally* (only when that specific round is selected) rather than
*instead of* the dashboard.
**Files:** `MyHQClient.tsx` (new), `tournament/page.tsx`
**Not verified on a real device** — this is the largest change in this
batch; see acceptance checklist below for exactly what to test.

### 5. Add to Home Screen / PWA prompt not reappearing after reset
**Reproduced:** yes, by code inspection.
**Root cause:** `beforeinstallprompt` fires exactly once per page load,
and the only listener for it lived inside `InstallPwaCard`, which only
ever mounts once a player reaches the trip Lobby (after login → trip
list → a specific trip — several navigations deep). By the time that
listener existed, the event had almost always already fired earlier in
the page's lifetime and gone unheard. Resetting the dismissal flag
correctly cleared localStorage, but there was no captured event left to
hand back — the card was correctly hiding itself by its own logic, with
nothing to show.
**Fix:** a small global singleton (`installPromptCapture.ts`) populated
by a listener mounted at the true app root (`layout.tsx`, rendered on
every page including login), via a tiny new
`InstallPromptCaptureInit.tsx`. `useInstallPrompt.ts` now reads from
this singleton — available immediately if the event already fired, or
via subscription if it arrives later in the same session — instead of
attaching its own late listener. Also moved the card's position, per
the explicit instruction, from underneath the collapsed Welcome
brochure to directly beside the "✅ Joined" status.
**Files:** `installPromptCapture.ts` (new),
`InstallPromptCaptureInit.tsx` (new), `layout.tsx`,
`useInstallPrompt.ts`, `PlayerHomeCard.tsx`
**Not verified on a real device.** iOS Safari's manual-instructions
path and the already-installed/standalone detection were not touched
and should be unaffected — only worth re-confirming as part of the
acceptance pass.

### 6. Scroll / sticky scoring tray
**Reproduced:** not reproduced — regression-tested and found intact.
**Result:** the `ResizeObserver`-measured spacer built in the previous
round is still in place and unmodified. No code path found that would
regress it. Treated as PASS pending on-device confirmation across the
specific state combinations listed in the acceptance section.

---

## PART B — REGRESSION OF THE LAST TWO SHARED-DEVICE RELEASES

All six verified by direct code inspection (not re-tested on device —
no browser/DB access from this sandbox). None were modified.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 7 | Shared-device score persistence | **Intact** | `partnerSelf[holeNum]` (not `partnerMarker`) still feeds the shared-device rehydration path in `SelfMarkerScoreShell.tsx` |
| 8 | Shared-device Round Summary | **Intact** | "Shared-device scoring complete ✓" message and logic unchanged |
| 9 | Confirm Final Scores / marker-wait gate | **Intact** | `scorecards/route.ts` still uses `resolveSharedDeviceGroupForPlayer` |
| 10 | Close Round | **Intact** | No `useEffect` re-introduced in `TournamentControl.tsx`; `tournament/route.ts` still resolves grouping via live `trip_members.group_id` (`groupIdByProfile`), not the broken `scorecards.group_id` column |
| 11 | Same-phone Side Game verification | **Intact** | `SideCompEntryPanel.tsx` still has `sharedDevicePartnerId`/`verifyAsPartner`; `entries/route.ts` GET still returns `entryId`/`requiredVerifierId` |
| 12 | Shared-device grouping resolver | **Intact, and re-confirmed this round** | Searched every API route under `src/app/api/trips` for direct `scorecards.group_id` logic reads — found none; every remaining occurrence is either a comment or an unrelated table's own `group_id` column (`round_group_starting_holes`, `trip_groups`, etc.). `resolveSharedDeviceGroupForPlayer` is used consistently by `close`, `scorecards`, `pending-verifications`, and `verify` routes; `tournament/route.ts` uses the equivalent live-source pattern directly rather than importing the shared function, but reads the same underlying data — no drift found. |

**Anything that could not be verified:** all of the above is code-level
verification only. None of it was exercised against real Supabase data
or a real device this round — that's the field test's job, not
something this sandbox can do.

---

## PART C — FIELD ACCEPTANCE RUN

**This could not be executed from this sandbox** — no browser, no live
Supabase connection, no real device. What follows is the acceptance
checklist to run on the next field test, organized exactly per the
brief's scenarios, plus what to specifically watch for given what
changed this round.

### Scenario A — Digital + Digital
Unaffected by this round's changes except items 1/2/3 (swipe, contrast,
leaderboard names) and item 4 (My HQ selector) if this trip has 2+
rounds. Standard regression: scoring, persistence, marker behaviour,
Side Games, final submission, Close Round.

### Scenario B — Digital + Paper
Standard shared-device regression per Part B above, plus: confirm swipe
navigation now works on this shell specifically (it's
`SelfMarkerScoreShell.tsx`, the exact file item 1's fix touched).

### Scenario C — Two-round event (the actual repro case for item 4)
1. Complete Round 1. Confirm My HQ still shows the full Round 1
   dashboard (not the CTA card replacing it) — this is the change to
   verify most carefully.
2. Move to Round 2 (begin it). Confirm Round 2 becomes selectable and
   shows Round 2's own live dashboard.
3. Select Round 1 again from the Event Schedule cards. Confirm it shows
   full Round 1 history — leaderboard, Side Games, group progress,
   completion status, Makers & Breakers, Moments, Event Story, final
   results — identical to what it showed right after Round 1 completed.
4. Switch back and forth several times. Confirm zero cross-round
   leakage (no Round 2 data appearing under Round 1's selection or vice
   versa) — `TournamentControl`'s own `roundId` prop drives every
   fetch, so this should hold structurally, but needs a real check.
5. Confirm the "Round 1 Complete / Round 2 ready" message still appears
   at the right moment (only when Round 1 is the selected round, per
   this round's change) and the "Event Complete" message appears
   correctly once every round is done.

### Scenario D — Mobile UX
Long names (item 3), expanded scorecards + scrolling (item 6, unchanged
this round), outdoor contrast (item 2), swipe navigation (item 1) — all
on a realistic phone width.

### Scenario E — PWA
1. Profile → "Show Add to Home Screen again."
2. Fully reopen the app (not just navigate within it — the fix depends
   on the root layout's listener attaching fresh) and open an event.
3. Confirm the concierge now appears **beside "Joined,"** not buried
   under the brochure.
4. Android Chrome: confirm the native install flow triggers. iOS
   Safari: confirm the manual-instructions sheet still works (untouched
   this round, but worth reconfirming given the surrounding file
   changed). Already-installed/standalone: confirm no prompt appears.
   Dismiss ("Maybe later"): confirm it doesn't reappear until reset
   again.

---

## ENGINEERING SUMMARY

- **Tests run:** `node --test` against all 30 files under
  `src/lib/scoring/**` (transpiled with the TypeScript compiler
  directly, since `npm install` is unavailable) — **224/224 pass**, no
  change from before this round (no business-logic file was touched).
- **TypeScript/syntax check:** all 10 files touched this round parsed
  with **zero errors** via direct TypeScript compiler invocation.
- **`npm run build`:** **not run** — no network access in this sandbox.
  This is the one verification step that has to happen on your end
  before this ships.
- **Migrations required:** **No.** Nothing this round touches the
  database schema. (Unrelated, carried over from a previous round's
  notes: `begin_round()`'s own INSERT still doesn't write
  `scorecards.group_id` — every consumer routes around it via the live
  `trip_members.group_id` instead, so this doesn't block anything, but
  a dedicated migration to restore that column properly is still worth
  doing separately, whenever there's time for it.)

## FILES CHANGED THIS ROUND

- `SelfMarkerScoreShell.tsx` — swipe fix, contrast fixes
- `ExpandableRoundScorecard.tsx` — contrast fixes
- `LiveLeaderboard.tsx` — name truncation fix
- `MyHQClient.tsx` (new) — My HQ round selector
- `tournament/page.tsx` — wired to `MyHQClient`
- `installPromptCapture.ts` (new) — global PWA prompt capture
- `InstallPromptCaptureInit.tsx` (new) — root-mounted listener
- `layout.tsx` — mounts the above
- `useInstallPrompt.ts` — reads from the global capture
- `PlayerHomeCard.tsx` — PWA card repositioned
