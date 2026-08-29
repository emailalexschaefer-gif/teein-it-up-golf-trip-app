# DARREN FIELD TEST — RELEASE 1 (Scoring & Event Reliability)
## Delivery Report — 2026-08-29, UPDATED after completing items 2, 3, 4

**Status: All nine Release 1 items now addressed.** This update covers
Items 2, 3, and 4, implemented as one integrated pass per the follow-up
instruction, since they share the same live-scoring state and
persistence architecture. Items 1, 5, 6, 7, 8, 9 (below, unchanged from
the original report) were not revisited.

**Build/test caveat, still unchanged:** no network access — `npm run
build` not run. All files touched syntax-checked directly with the
TypeScript compiler, zero errors across every file in both passes. Full
`src/lib/scoring/**` suite: **240/240 pass** (236 from before + 4 new
final-hole tests this pass).

---

## Inspection phase (done before any edit, per the explicit instruction)

Traced the full existing scoring flow first:

- **Playing Partner selection/storage:** `round_markers` table,
  directional (`marker_player_id` → `player_id`), managed by
  `playing-partner/route.ts` — confirmed already correct from the
  original pass.
- **Live scoring's marker resolution:** `currentMarked =
  liveData.markedScorecard`, refreshed via `refetchLive()`.
- **Confirm Score handler:** `confirmScore()` — required `canConfirm`
  (both players' data present) before doing anything at all, including
  the actual `queueScoreEntry` calls. This was the real friction: no
  data was even queued locally until every required field was filled.
- **Forward/back swipe:** `onTouchEnd` — called `setHoleIdx` directly,
  entirely separate from `confirmScore`'s own save+advance logic.
- **Previous/Next buttons:** also called `setHoleIdx` directly, a third
  independent implementation of the same navigation.
- **Offline/local persistence:** `queueScoreEntry` (Dexie-backed local
  queue) → `syncScoreQueue()`. Confirmed this is the single persistence
  path already used everywhere; not touched or duplicated.
- **Final-hole detection:** `isLastHole = !isShotgun && holeIdx >=
  holes.length - 1` already existed inside `confirmScore` — already
  array-position-based (not `hole_number === 18`), thanks to the
  Starting Tee work — but only reachable via the Confirm Score path,
  and only opened Round Summary in marker mode; individual/solo scoring
  had no equivalent trigger at all.
- **Shotgun's circular sequence:** confirmed genuinely separate — driven
  by a distinct `allDone` polling check (`holes.every(...)`, watches
  captured data directly), not by array-boundary navigation at all.
  Left completely untouched.

---

## Item 2 — Change who I'm marking

**Implemented.** The backend route already anticipated this in its own
error message ("Use 'Change who I'm marking' to switch") but had no way
to actually do it — a second selection was blocked with a 409.

- `playing-partner/route.ts` POST is now an **upsert**: if the caller
  already has a `round_markers` row, it's `UPDATE`d to the new
  `player_id` instead of being blocked. Only `round_markers.player_id`
  changes — no scorecard or score_entries row for the caller, the old
  partner, or the new partner is ever read or written by this route, so
  every "preserve" requirement is satisfied by construction, not by
  extra defensive code.
- GET now always returns real candidates, even when already paired
  (previously came back empty once paired, since the only caller was
  the one-time initial-selection screen).
- Client: a `changingPartner` state reuses the exact existing
  selection screen (title/copy adjusted, current partner highlighted,
  a Cancel option added — absent from the required first-time flow,
  where cancelling doesn't make sense). A "✎ Change who I'm marking"
  link sits directly above the partner's scoring card, always visible
  during live scoring, not buried in a menu.
- The still-real architectural conflict from item 1 (two players can't
  both be recorded as marking the same third player —
  `UNIQUE(round_id, player_id)`) is preserved and still correctly
  surfaces a 409 on the update path too, not silently swallowed.

## Item 3 — Remove Confirm Score / save-on-navigation

**Implemented.** `confirmScore()` is gone, replaced by two functions:

- `saveCurrentHoleData()` — persists whatever valid draft data exists
  (mine, and the partner's if marker mode), reusing **every existing
  persistence call verbatim** (`queueScoreEntry` for self/marker,
  `shared-device-score` for a shared-device partner) — same offline
  queue, same sync architecture, no parallel mechanism. Returns
  immediately, doing nothing, if the hole is genuinely blank — per the
  explicit "a blank score must never prevent navigation."
- `saveAndAdvance(direction)` — the one shared function Next Hole,
  Previous Hole, forward swipe, and backward swipe **all** call now
  (previously three independent implementations). Awaits the save,
  then navigates — ordering into the offline queue stays correct even
  under rapid swiping, since each save is awaited before the next
  hole's own save could begin.
- Shared-device Digital + Paper: `hasMyData`/`hasPartnerData` are
  evaluated independently — one blank card never blocks saving or
  navigating past the other's valid data, matching the explicit
  requirement.
- If the local queue write itself genuinely fails, the existing
  "Saved locally — will sync when online" toast still fires — the same
  failure-surfacing `confirmScore` already had, not a new state.

## Item 4 — Final played hole → Round Summary

**Implemented**, and required no new sequence logic — the groundwork
from Starting Tee support was already exactly right. `holeIdx >=
holes.length - 1` against the already-correctly-ordered `holes` array
is already the right check for all four configurations without needing
to know which one it is. What changed:

- This check now applies **uniformly** — previously only fired in
  marker mode; individual/solo scoring stayed on the completed final
  hole indefinitely with no transition at all. Now both modes reach
  Round Summary the same way.
- Forward navigation off the final hole now goes through
  `saveAndAdvance`, so it **saves first**, then opens Round Summary —
  previously, tapping "Round Summary →" directly (rather than Confirm
  Score first) skipped the save entirely.
- Shotgun explicitly untouched — its own `allDone` polling mechanism
  is what opens Round Summary for a shotgun round; navigation reaching
  the "end" of the array never does, since there is no end in a
  circular sequence.

**Tests added:** 4 new tests in `holeSequence.test.ts`, confirming the
last entry of `computeHolePlayOrder`'s output is the correct physical
hole for all four configurations (9/1st→9, 9/10th→18, 18/1st→18,
18/10th→9, explicitly not 18). The `saveAndAdvance`/
`saveCurrentHoleData` functions themselves are not unit-tested in
isolation — they're component-level async functions with many
dependencies (draft state, network calls, query invalidation), the
same as `confirmScore` was before them; genuinely isolating them would
need a larger extraction than this pass attempted.

## FILES CHANGED THIS PASS

- `playing-partner/route.ts` — item 2 (upsert, always-return-candidates)
- `SelfMarkerScoreShell.tsx` — items 2, 3, 4 (change-partner UI,
  `saveCurrentHoleData`/`saveAndAdvance`, swipe/button/final-hole wiring)
- `holeSequence.test.ts` — 4 new final-hole tests

## KNOWN GAPS

- **Not verified on a real device.** This is the honest, significant
  gap — everything above is syntax-checked and the pure sequence math
  is tested, but the actual save-on-navigate behavior, rapid swiping,
  offline recovery, and the change-partner flow all need real-device
  testing before this ships.
- The "Round Summary →" button label swap (showing on the final hole)
  relies on `holeIdx` at render time; worth confirming on-device that
  the label updates the instant navigation lands on the final hole, not
  one render behind.
- No new tests for `saveAndAdvance`/`saveCurrentHoleData` themselves —
  see above.
- Items 1, 5, 6, 7, 8, 9 unchanged from the original report — see below
  for their status.

---

# ORIGINAL REPORT (items 1, 5–9) — unchanged


---

## Item 1 — Remove Playing Partner auto-pairing

**Already correctly implemented** — confirmed by reading
`playing-partner/route.ts` and `start/route.ts` in full. The directional
model ("Marnie → Darren does not imply Darren → Marnie") is in place;
`autoGenerateMarkers` in `start/route.ts` is an inert no-op stub, kept
rather than deleted so its two call sites didn't need touching. The
route is permissive by design — candidates aren't excluded just because
someone else already chose them, matching "golfers can resolve that
themselves." One architectural conflict is explicitly flagged in the
route's own comments: `round_markers` has `UNIQUE(round_id, player_id)`,
so two different players genuinely cannot both be recorded as marking
the same third player — the second attempt gets a clear 409, not silent
corruption. Fully relaxing that would need a schema change with wider
regression risk; correctly reported rather than worked around blindly.

No changes made — this was already correct.

## Item 2 — Change Playing Partner mid-round

**Implemented this pass — see updated section above.**

## Items 3 & 4 — Remove Confirm Score / auto-save navigation / final-hole via play sequence

**Implemented this pass — see updated section above.** Was correctly
deferred in the original pass rather than rushed; completed as one
integrated change per the follow-up instruction.

## Item 5 — Round Summary: separate RESULT from INTEGRITY

**Fixed.** Traced the exact bug: the reconciliation card's second
column was labelled with the partner's name but displayed
`markerGrandTotal` — **the current player's own card, as recorded by
their marker** — not the partner's actual round total. "Alex Schaefer
51 — Matched — Darren Lappen 51" was genuinely two representations of
Alex's card, mislabelled as if the second number were Darren's own
result.

- Added a new headline: each player's real, independently-entered
  total (computed from `partnerSelf` — the partner's own
  `capture_role='self'` entries, already fetched generically for any
  marker pairing, not just shared-device) shown side by side —
  "Alex Schaefer — 51 pts" / "Darren Lappen — 47 pts."
- The reconciliation card is unchanged in its underlying data, but
  relabelled "My Card" / "{Partner}'s Record" under a new "CARD
  INTEGRITY" section header, so it can't be mistaken for a second
  player's result again.
- Paper/shared-device players already used the correct data source
  (`partnerSelf`) for their own comparison card from earlier work —
  this fix generalizes that same source to genuine two-digital-player
  marker mode too, which had been the one remaining case still using
  the wrong (marker-copy) source.

**Scope decision, reported rather than silently assumed:** this screen
only ever has live data for the current player and the ONE partner
they're marking — for a group larger than two, this headline still only
shows that pair, not every group member. A true multi-player comparison
belongs on the Leaderboard tab (which already aggregates every player
via `computeCumulativeStandings`), not duplicated here. I did not build
a new N-player view inside this per-hole scoring screen.

## Item 6 — Tee time redundancy

**Already correctly implemented** — confirmed `BeginRoundModal.tsx`
reads and pre-fills from `round_group_tee_times` (the same table
Playing Groups already wrote to), shown as an editable field with the
existing value, not a blank field asking the organiser to re-enter it.
No changes made.

## Item 7 — iPhone fixed-bottom-nav obstruction

**Partially fixed, not a full audit.** Searched the app for every
component using the same `position:fixed, bottom:0` bottom-sheet
pattern — found exactly one beyond the app's own bottom nav bar (which
was already correctly safe-area-aware): the Archive/Delete Trip
confirmation dialog in `TripOverviewTab.tsx`. It had a fixed 36px bottom
padding with no `env(safe-area-inset-bottom)` at all — fixed to add it,
reusing the exact mechanism already established elsewhere in the app
rather than guessing a larger fixed number.

**What this doesn't cover:** the brief explicitly asked for a genuine
audit "against iPhone Safari, installed PWA, Android Chrome, Android
PWA" of "bottom sheets/modals/long forms" generally. I found and fixed
the one other component matching this exact structural pattern via
grep, but did not manually walk every modal/long-form screen in the app
checking for a *differently*-structured version of the same problem
(e.g., a long form relying on page-level scroll rather than a fixed
sheet, which wouldn't match this search pattern). Flagging this as an
incomplete audit, not a confirmed-complete one.

## Item 8 — Live Leaderboard mobile formatting

**Fixed.** Root cause: "PREVIOUS"/"CURRENT" spelled out in full (8
characters, plus letter-spacing) simply don't fit in the 44px columns —
the exact width I reduced them to two rounds ago specifically to
reclaim room for full player names. That reclaimed space was correct;
the header text just wasn't adjusted to fit it. Shortened the header
labels to "PREV"/"CUR"/"TOTAL" and tightened letter-spacing slightly —
column *widths* are unchanged (still match the data cells exactly, so
nothing misaligns), and player names are untouched — this only
abbreviates header labels, not names, so it doesn't reopen the
truncation problem the width reduction fixed in the first place.

## Item 9 — Password reset with signup verification disabled

**Verified correct at the code level, not device/dashboard-verified.**
`ResetPasswordForm.tsx` already uses Supabase's standard, supported
recovery flow end to end: `resetPasswordForEmail()` → PKCE code exchange
in `/api/auth/callback` → an established recovery session →
`updateUser({ password })`. This is architecturally independent of
Supabase's signup email-confirmation toggle — recovery emails are a
separate mechanism at the Supabase Auth API level, not gated by whether
signup requires confirmation. No code changes made or needed.

**What I cannot verify from this sandbox:** the actual live Supabase
project's Auth configuration (SMTP settings, redirect URL allowlist,
whether the "Confirm email" toggle has any project-specific interaction
with recovery emails in this instance) — that needs a real check against
the live dashboard, not something a code read can confirm.

---

## FILES CHANGED — CONSOLIDATED (both passes)

- `SelfMarkerScoreShell.tsx` — item 5 (Round Summary headline + card
  relabel); items 2, 3, 4 (change-partner UI, `saveCurrentHoleData`/
  `saveAndAdvance`, swipe/button/final-hole wiring)
- `TripOverviewTab.tsx` — item 7 (safe-area padding)
- `LiveLeaderboard.tsx` — item 8 (header label fix)
- `playing-partner/route.ts` — item 2 (upsert, always-return-candidates)
- `holeSequence.test.ts` — 4 new final-hole tests

## TESTS — CONSOLIDATED

Items 5, 7, 8 were pure display/labelling fixes or verifications of
already-correct code (items 1, 6, 9) — no new tests needed there. Items
2–4 added 4 new tests in `holeSequence.test.ts` confirming the final
played hole for all four Starting Tee configurations. Full
`src/lib/scoring/**` suite: **240/240 pass** (236 pre-existing + 4 new),
confirming no regression from either pass.

## KNOWN GAPS — CONSOLIDATED

- **All of Release 1 is now implemented, but none of it has touched a
  real device.** This is the single biggest remaining gap — everything
  is syntax-checked and (where applicable) pure-function tested, not
  device-verified. Items 2, 3, 4 in particular — the core scoring-
  navigation rewrite — need careful real-device testing before this
  ships: rapid swiping, offline recovery, the change-partner flow, and
  the final-hole → Round Summary transition across all four Starting
  Tee configurations plus Shotgun.
- Item 7's audit is partial, not exhaustive (one component fixed via
  pattern search, not a manual walk of every modal/long-form screen).
- Item 9's live Supabase dashboard configuration is unverified (code is
  confirmed correct; SMTP/redirect-URL config needs a live check).
- Item 5's group-size scope decision (pair-only, not full group) should
  be confirmed as acceptable rather than assumed.
- `saveAndAdvance`/`saveCurrentHoleData` are not unit-tested in
  isolation — they're component-level async functions with many
  dependencies (draft state, network calls, query invalidation), same
  as `confirmScore` was before them.

## REAL-DEVICE ACCEPTANCE CHECKLIST — FULL RELEASE 1

Every item from your original regression gate, now that all nine items
are implemented:

- [ ] Digital → Digital marker selection
- [ ] Digital → Paper marker selection
- [ ] 2-player group without auto-pairing
- [ ] 3-player group without auto-pairing
- [ ] change marker mid-round (**new**) — the "✎ Change who I'm
      marking" link above the partner card, both directions
      (Digital→Digital, Digital→Paper)
- [ ] existing scores survive marker change (**new**) — enter several
      holes, change partner, confirm nothing was lost for either player
- [ ] swipe forward with scores (**new behaviour** — now saves via
      `saveAndAdvance`)
- [ ] swipe forward with blank scores (**new** — must still navigate,
      nothing required)
- [ ] navigate backwards and edit, then advance again — confirm the
      edit persists (**new**)
- [ ] Digital + Paper same-device scoring — one blank card must not
      block the other (**new**)
- [ ] rapid hole navigation — confirm no entered score is silently lost
      (**new** — the highest-stakes single test in this release)
- [ ] offline persistence under the new save-on-navigate model
      (**new**)
- [ ] final-hole → Round Summary, individual/solo mode (**new** —
      previously never transitioned automatically)
- [ ] final-hole → Round Summary, marker mode, saves before
      transitioning (**new**)
- [ ] 18-hole 10th-tee sequence: confirm final hole is 9, not 18, and
      Round Summary opens correctly (**new**)
- [ ] Shotgun regression: confirm circular navigation and its own
      Round Summary trigger are unaffected (**should be unchanged —
      verify no regression**)
- [ ] Round Summary shows actual player totals
- [ ] reconciliation still functions, clearly separated from result
- [ ] tee time persists from Groups → Finalise
- [ ] narrow iPhone: Archive Trip dialog reachable above safe area
- [ ] narrow leaderboard formatting: headers don't collide, names
      remain full
- [ ] password recovery email works (live test)
- [ ] signup remains frictionless

This is the full gate before packaging — nothing here is deferred to a
follow-up pass any more; every item above should be tested before
Release 1 ships.
