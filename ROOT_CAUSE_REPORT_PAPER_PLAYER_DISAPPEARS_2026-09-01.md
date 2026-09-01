# P0 — PAPER PLAYER APPEARS THEN DISAPPEARS AFTER LIVE SCORING LOAD
## Root Cause Report — 1 Sep 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. Both files
touched syntax-check with **zero errors**. Full test suite: **318/318
pass** (251 scoring + 59 highlights + 8 analytics), confirmed
unaffected.

---

## The exact answer to your deliverable's core question

**What changed between the render where TEST was visible and the
render where TEST disappeared? Give us the exact state/query/effect
responsible.**

`partnerName`, which is `currentMarked?.profiles?.full_name ?? null`,
where `currentMarked = liveData.markedScorecard` — and `liveData` is
the `useQuery` result of your own polling refresh (`refetchInterval`
≈7 seconds while the round is active, exactly matching your own
"shortly afterwards" observation). On first paint, `liveData` is
seeded via `initialData` from `page.tsx`'s server-rendered props, where
`markedScorecard` was correctly resolved to TEST's card via shared-
device detection — so `partnerName` is genuinely "TEST" and Card 2
renders. ~7 seconds later, the poll fires, hits
`/api/.../my-scores`, and that route's own `markedCard` resolution
**had no shared-device detection logic at all** — only a
`round_markers` lookup, which is never written for a shared-device
pair. The poll returns `markedCard: null`. `liveData.markedScorecard`
becomes `null`. `currentMarked` becomes `null`. `partnerName` becomes
`null`. Card 2's render condition (`markedScorecard && partnerName`)
goes false. TEST disappears.

This is a genuine runtime state-loss bug, exactly as your brief
suspected — not a detection failure. The detection was never wrong;
one specific endpoint just never knew shared-device pairing existed.

---

## Was this specifically introduced by back-nine/starting-hole functionality?

**No.** This bug is completely independent of starting hole. The
`/my-scores` route's missing shared-device detection has nothing to do
with which hole the round starts on — it would produce the identical
"appears then disappears" symptom on a Hole 1 start too, on the exact
same ~7-second cadence, for the same reason. Per your own item 4:
because TEST successfully appeared at least once, and the actual cause
turned out to be a completely hole-agnostic polling endpoint, back-nine
starts should be considered ruled out as the primary cause — not
proven irrelevant by assumption, but by finding the actual mechanism
and confirming it has no hole-number dependency anywhere in it.

---

## Trace, per your item 1 — the values that changed between render A and render B

| Value | Render A (TEST visible) | Render B (TEST gone) | Changed? |
|---|---|---|---|
| `isSharedDeviceScoring` (prop) | `true` | `true` | **No** — frozen from initial server render, never reassigned |
| `markedScorecard` (prop) | TEST's card object | TEST's card object | **No** — same, frozen prop |
| `requiresMarker` | `true` (self_and_marker mode) | `true` | No |
| `currentMarked` (= `liveData.markedScorecard`) | TEST's card | **`null`** | **Yes — this is the actual break** |
| `partnerName` (derived from `currentMarked`) | `"TEST"` | **`null`** | **Yes — this is what the render gate actually observes** |
| `partnerSelf`/`partnerMarker` | populated | reset to `{}` (hydration effect re-runs off `currentMy`, `currentMarked` becomes null → `theirs = { self: {}, marker: {} }`) | Yes, downstream of the above |
| current round ID / group ID | unchanged | unchanged | No |
| current hole number | unchanged | unchanged | No — confirms this is unrelated to navigation or hole state |
| loading/refetch state | resolved | a poll just completed | The poll itself is the trigger |

**The one query responsible:** `GET
/api/trips/[tripId]/rounds/[roundId]/my-scores`, fired by
`SelfMarkerScoreShell.tsx`'s `refetchInterval` (~7s).

---

## Item 2 — the hydration/refresh race

Confirmed exactly the shape you described: server resolves the paper
player correctly → component initially renders TEST → client
refetch completes → **that refetch used a narrower resolution rule
than the server did** → the shared-device relationship is
overwritten with nothing → Card 2 disappears. Not a `setPartner(null)`
call anywhere in the client — the loss happened one layer down, in
what the *server route* returned to a completely ordinary "refresh my
data" query.

**Confirmed your explicit requirement**: the paper/shared-device
relationship should not depend on `round_markers` — it doesn't, and
never did, in `page.tsx`'s own resolution. The bug was that one other
route quietly *did* depend on `round_markers` exclusively, with no
awareness the shared-device path existed at all.

## Item 3 — paper player start-scoring lifecycle

Re-confirmed (from the prior session's work, migration 069) that
scorecard creation itself is unaffected by any of this — TEST's
scorecard is created the moment Alex presses Start Scoring, regardless
of TEST ever logging in. This bug is entirely downstream of that,
in how an *already-created* shared-device relationship gets
(mis)represented on a later poll. No "started players" filter was
found anywhere — the missing piece was shared-device *detection*, not
a status filter excluding TEST.

## Item 5 — the "Change who I'm marking" conflict, confirmed and fixed separately

You were right to flag this. Traced it and found a second, related
bug: last round's fix correctly broadened Card 2's *visibility* to
include shared-device pairs, but the "Change who I'm marking" button
underneath it was still gated only by `requiresMarker` — a round-level
flag (`score_capture_mode === 'self_and_marker'`) that says nothing
about whether *this specific pairing* is shared-device. A round in
`self_and_marker` mode can contain both a genuine marker relationship
(a different group, digital+digital) and a shared-device relationship
(this group, digital+paper) at the same time — `requiresMarker` alone
can't distinguish them. This explains exactly why that button appeared
in your screenshot. Fixed to `requiresMarker && !isSharedDeviceScoring`
— the button now only ever appears for a genuine marker relationship,
never a shared-device one, matching your explicit "the rules should
remain separate" requirement.

---

## Files changed

- **`src/app/api/trips/[tripId]/rounds/[roundId]/my-scores/route.ts`**
  — added the identical shared-device detection `page.tsx` already
  uses (same `detectSharedDeviceGroup` call, same group-scoped query),
  checked first; `round_markers` is now only consulted when this
  specific pairing isn't shared-device. Corrected the route's own
  docstring, which previously claimed (incorrectly) to mirror
  `page.tsx` exactly.
- **`src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx`**
  — "Change who I'm marking" button now excludes shared-device pairs
  explicitly, not just implicitly assumed.

## Migration/RPC/RLS changes: none

This was a data-shaping bug in one API route's response, not an
authorization gap. The digital-player-scores-paper-player authority
model itself was re-traced this session and confirmed unchanged — no
narrower or broader access was introduced by this fix. No RLS policy,
no RPC signature, no new table.

## Test results

- Focused: none new — this fix corrects which existing, already-tested
  detection function (`detectSharedDeviceGroup`, exercised by 251
  passing scoring tests) a second route calls, not new logic requiring
  its own unit test.
- Full suite: **318/318 pass**, confirmed unaffected.
- **The actual required verification — your 6-step hard acceptance
  test, specifically the "wait 10-15 seconds, TEST must remain
  visible" step — was not run.** This sandbox cannot run a live app
  against a live database or wait out a real polling interval. This is
  the one gap in this report, and it's the single most important thing
  to verify before calling this closed.

---

## Production retest steps

1. Fresh event, Alex (Digital) + TEST (Paper), same group, Hole 10
   start, finalise/release.
2. Only Alex logs in, presses Start Scoring.
3. Confirm both cards appear immediately (already worked before this
   fix — not what changed).
4. **Wait at least 15 seconds without touching anything** — this is the
   step that would have failed before this fix and is the direct test
   of it. TEST's card must still be there.
5. Enter different scores for both, advance to Hole 11, confirm both
   remain visible through the transition and through at least one more
   poll cycle (another 15+ second wait).
6. Navigate backward, confirm both scores are still correct.
7. Refresh the browser entirely — confirm the relationship
   re-establishes correctly from a cold load (this exercises `page.tsx`
   again, which was never broken, but worth confirming nothing about
   this fix disturbed it).
8. Confirm the "Change who I'm marking" button does **not** appear
   anywhere in Alex's shared-device card, at any point.
9. Repeat the entire sequence from a Hole 1 start.
10. If a shotgun round using the same self+marker shell is available,
    repeat once there too.
