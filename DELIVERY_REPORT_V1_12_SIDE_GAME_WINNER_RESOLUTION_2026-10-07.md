# SIDE GAME WINNER SLIDESHOW CONSISTENCY FIX
## Delivery Report

NOT DEPLOYED, per your explicit instruction. Build/test caveat,
unchanged from every prior round: no network access, no live
database/Storage connection, no browser or real device.

**Per item 13 of your own reporting requirements: this report does
NOT claim your actual Round 2 production issue is fixed.** It reports
what this surgical implementation does, what it's tested against with
constructed data, and what remains genuinely unverified until the
deployed implementation is checked against live data -- see item 12.

---

## 1. EXACT FINALISATION STATE/FIELD DISCOVERED

`rounds.status === 'completed'`. Confirmed authoritative by reading
the actual code, not assumed:
- The round-close route (`/rounds/[roundId]/close/route.ts`) sets
  `rounds.status = 'completed'` at line 119, and calls
  `finalize_side_comp_winners()` as part of that same close operation.
- `get_my_golf_summary()`'s own self-healing reconciliation (migration
  082) already uses `r.status = 'completed'` as its own gate for
  deciding which rounds are eligible to retry finalisation -- i.e.
  this is not a field I selected for this purpose; it is the same
  field the codebase's own existing finalisation-adjacent logic
  already treats as authoritative.

No new flag was introduced.

## 2. EXACT SIDE GAMES COMPLETION PREDICATE/WINNER LOGIC DISCOVERED

`src/lib/sideGames/computeRoundSideGames.ts`, the exact function
backing the live Side Games screen (`/rounds/[roundId]/side-games`).
Its `winner` field, per Side Game, is:

```
isComplete = isHoleComplete(comp.hole_number)   // every active, non-
                                                  // withdrawn scorecard
                                                  // has a 'self' score_entry
                                                  // for that hole
winner = isComplete ? currentLeader : null
```

Where `currentLeader` is computed differently by comp type:
`longest_drive` uses the most recent `side_comp_lead_changes` row
whose entry is qualified+verified; every other type uses the
qualified+verified entry with the best (lowest) `result_value`.

**A genuine, pre-existing divergence surfaced during this audit** (not
introduced by this change): the *official* SQL finalisation function,
`finalize_side_comp_winners()`, always uses the latest
`side_comp_lead_changes` row for every comp type, regardless of type
-- it does not branch by comp type the way the live screen does. For
`longest_drive` these two algorithms agree by construction. For other
types (e.g. `nearest_pin`), they are genuinely different algorithms
that could, in principle, pick different winners from the same raw
data. This is a real, separate finding, reported per your own "if a
completely separate genuine defect is discovered, report it rather
than expanding this pass without approval" instruction -- **no change
was made to either algorithm**. Because this fix always prefers the
official result the moment it exists (priority 1), and the fallback
only ever applies to not-yet-finalised Side Games, this divergence
cannot actually produce a wrong *display* here -- but it is worth your
awareness as a separate potential inconsistency between the live
screen and the eventual official result on a non-longest_drive Side
Game.

## 3. REUSED VS. DUPLICATED

Reused. `computeRoundSideGames()` is imported directly into
`eventMemoryData.ts` and called for every round not yet
`'completed'` -- not reimplemented. This guarantees identical
completion/winner behaviour by construction, not by two
implementations being kept in sync by hand. Only the *priority*
logic (official vs. fallback vs. no-winner) is new code, isolated in
its own pure module (`resolveSideGameWinner.ts`) specifically so it
has nothing to do with Side Games' own completion/winner
determination, which is never touched or redefined.

## 4. EXACT NORMALISED PRESENTATION-WINNER SHAPE

Unchanged from before this pass -- the existing `SideGameWinner`
shape already matched the Priority 2 brief's requirements exactly, so
no shape change was needed:

```typescript
{
  sideCompId: string
  roundId: string
  compType: string
  label: string
  holeNumber: number | null
  winnerPlayerId: string | null
  winnerName: string | null
}
```

Both the official and fallback paths produce exactly this shape via
the same `resolveSideGameWinner()` function -- confirmed directly by
test 10 and test 11 (item 8 below), which assert the two paths are
genuinely indistinguishable once resolved, field-for-field.

## 5. ADDITIONAL READ-ONLY DATA NOW LOADED

`computeRoundSideGames(admin, roundId)` is called once per round
whose `status !== 'completed'` (never for an already-finalised round,
since its winners are already fully resolved by the official path and
gain nothing from the extra computation). This reads `side_comps`,
`scorecards`, `holes`, `side_comp_entries`, `side_comp_lead_changes`,
`moments`, and signs Storage URLs for lead-change thumbnails --
exactly the same reads the live Side Games screen itself already
performs for that round, scoped the same way (`eq('round_id',
roundId)` throughout, inherited from the reused function). No new
table, no new query shape, no change in scope beyond "the same read
the live screen already does, now also triggered from Event Memories'
own data load for unfinalised rounds."

## 6. CO-WINNER FINDINGS

The live Side Games screen does not support co-winners/ties at all.
`computeRoundSideGames.ts`'s own `winner` field is always a single
entry, never an array, for every comp type -- for `longest_drive` it's
the single most recent qualifying lead change; for other types it's
`array.sort(...)[0]`, which resolves to one entry even when multiple
players share the best `result_value` (picked by sort-stability, not
by any explicit tie rule). Since this fix's entire mandate is to
mirror that screen exactly, there is no tie behaviour to carry
forward -- the fallback path simply never produces more than one
winner, because its source never does either. No slideshow template
or winner-slide structure change was needed or made.

## 7. EXACT FILES CHANGED

- `src/lib/trips/resolveSideGameWinner.ts` (new) -- the pure priority resolver
- `src/lib/trips/resolveSideGameWinner.test.ts` (new) -- its regression tests
- `src/lib/trips/eventMemoryData.ts` (modified) -- wires the resolver and the scoped `computeRoundSideGames` calls into the existing `sideGameWinners` construction

**Confirmed by file-timestamp check, not just by intent, that nothing
else was touched this session**: `slideshowDeck.ts`,
`EventHighlightsPlayer.tsx`, and the memories `page.tsx` all carry
timestamps from before this session's work began. The hard gate
(templates, Final Leaderboard, Favourite/Blooper, selection
architecture, Event-at-a-Glance, landscape/fullscreen, photo
containment, scoring, round-close) was fully respected.

## 8. TESTS ADDED/CHANGED, AND WHY

10 new tests in `resolveSideGameWinner.test.ts`, covering your
required scenarios 1, 2, 3, 4, 6, 7a, 7b, 10, and 11 directly against
the pure resolver (scenario 5's tie case is covered by a test
confirming the fallback signal's shape is always a single winner, per
item 6 above -- there is no tie case to construct, because the source
being mirrored never produces one). Scenarios 8 and 9 (a three-round
event where Round 2 alone relies on the fallback, and the deck
actually generating its slides) are satisfied by the **existing**
"V1.11 regression" tests already in `slideshowDeck.test.ts` from the
prior session -- those tests assert the full pipeline
(`getAvailableSections` -> `defaultPresentationConfig` ->
`buildPresentationDeck`) correctly handles a middle round with winner
data, and since this fix's entire point is that a fallback-resolved
winner is indistinguishable from an official one by the time it
reaches that pipeline, those tests already prove scenarios 8/9 hold
for either source. Re-running them (confirmed below) is the proof
that nothing in this pass broke that guarantee.

**No existing test was changed.** Every test passing before this
session still passes unchanged.

## 9. STALENESS/CACHE AUDIT RESULT

Traced the full lifecycle you asked for:
- `PresentationConfig` (what actually gets saved/reused across a
  slideshow-building session) contains **only section toggles and
  scope choices** -- confirmed by reading its full interface directly.
  It never stores a winner's identity, name, or any Side Game result
  data. There is nothing for a fallback winner to "stick" inside.
- The manifest route (`/api/trips/[tripId]/memory-manifest`) calls
  `createClient()` -> `supabase.auth.getUser()`, which reads request
  cookies -- in Next.js App Router this automatically forces dynamic
  rendering, meaning **no static caching occurs**. Every open/refresh
  of Event Memories re-runs the full data load, including this
  resolver, against current data.
- **Conclusion: official state automatically supersedes a prior
  fallback on the very next refetch, with no code change needed.**
  The resolver always checks `officialWinnerPlayerId !== null` first,
  unconditionally -- the moment a round closes and
  `official_winner_entry_id` populates, the next page load/refresh
  picks it up.
- The specific edge case you asked about -- a fallback winner existed,
  then formal finalisation subsequently produces NO official winner
  for that Side Game -- is exactly test 7b: once `roundIsFinalised`
  is true, `officialWinnerPlayerId === null` resolves to authoritative
  no winner, full stop, regardless of what the fallback would have
  said. Confirmed by a passing test, not merely reasoned about.
- No cache changes were made, because the audit found no real defect
  to fix here.

## 10. EXACT TARGETED TEST RESULTS

`resolveSideGameWinner.test.ts`, run in isolation first: **10/10
pass.**

`slideshowDeck.test.ts`, run next to confirm the existing downstream
pipeline (which this change feeds into but does not modify) is
unaffected: **107/107 pass, unchanged from before this session.**

## 11. EXACT FULL FRESH TEST-SUITE RESULTS

Every package, run fresh, after the targeted runs above:
- `src/lib/scoring/**`: 291 pass
- `src/lib/highlights/**`: 68 pass
- `src/lib/analytics/**`: 8 pass
- `src/lib/profile/**`: 7 pass
- SQL-scanning/migration contract tests: 63 pass
- `src/lib/trips/**`: 228 pass (218 prior + 10 new resolver tests)

**665/665, genuinely run fresh this session.**

## 12. REQUIRING LIVE DATABASE/DEVICE VERIFICATION

Everything about whether this actually resolves your real Round 2.
Specifically, and stated plainly rather than implied:
- Whether Round 2 in production is genuinely `status !== 'completed'`
  (the scenario this fix addresses) or is in fact already
  `'completed'` with a null official winner for those two Side Games
  (in which case this fix correctly does nothing, by design, per
  priority 1b -- and the real explanation would be something else
  entirely, requiring separate investigation).
- Whether `computeRoundSideGames`, called from this new context,
  behaves identically against live data as it does for the live Side
  Games screen's own request -- the function itself is unchanged and
  reused verbatim, but this is its first use outside that screen's
  own route, so a live run is the only way to confirm there's no
  environment-specific assumption (RLS, auth context passed via
  `admin` client, etc.) that differs between the two call sites.
- The separate official-vs-fallback algorithm divergence noted in
  item 2, for any non-`longest_drive` Side Game in your real data --
  whether it has ever actually produced different winners in practice
  is unknown without comparing live results.
- General performance: calling `computeRoundSideGames` for every
  unfinalised round adds real query volume to the Event Memories
  data load. This is scoped correctly (only unfinalised rounds, never
  all of them), but its actual latency impact has not been measured
  against a live database.

## 13. DELIBERATELY NOT IMPLEMENTED, AND WHY

- **No change to `finalize_side_comp_winners()`, round-close
  semantics, or the official winner-determination algorithm** --
  explicitly out of scope per your hard gate, and per the read-only
  safety boundary in Priority 4 of your brief.
- **No resolution of the official-vs-fallback algorithm divergence**
  found in item 2 -- reported, not fixed, per your own "report rather
  than expand this pass without approval" instruction.
- **No change to any slideshow template, the Final Leaderboard,
  Favourite/Blooper, the Memories selection architecture, Event-at-
  a-Glance, landscape/fullscreen, or photo containment** -- confirmed
  untouched by file timestamp, not merely by intent (item 7).
- **No provisional/unofficial/"live"/pending badge of any kind** on a
  fallback-resolved winner -- it renders identically to an official
  one, per your explicit instruction, proven by tests 10/11.
- **Not deployed**, per your explicit instruction.
