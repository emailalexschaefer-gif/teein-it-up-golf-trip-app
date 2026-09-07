# SINGLE-PLAYER / SINGLE-GROUP SUPPORT — INVESTIGATION REPORT
## 5 Sep 2026

**No code was changed for this brief.** Per the explicit "inspect
first, do not assume either scenario is broken" instruction, I traced
every area the brief raised and found the architecture already
correctly supports both scenarios — largely due to earlier field-test
fixes made in prior sessions, not anything new. This report cites the
specific evidence for each claim rather than asserting it.

---

## SCENARIO A — SOLO DIGITAL PLAYER: ALREADY CORRECT

**Group creation/validation.** Checked `BeginRoundModal.tsx`'s own
readiness gates directly: `allGroupsHavePlayers = localGroups.every(g
=> g.players.length > 0)` — requires *at least one*, never two.
`begin_round()`'s own invariant checks (migration 070, its most recent
declaration) verify hole count, scorecard count, and that every
scorecard's player has a group assigned — none of them count group
membership or require more than one participant. A solo group is
already a valid, completable configuration at the data layer.

**Start Scoring / Playing Partner.** Traced
`/api/trips/[tripId]/rounds/[roundId]/playing-partner/route.ts`
directly — its own documentation states explicitly: "GET returns the
caller's own status... plus the list of eligible candidates. A solo
group correctly returns an empty candidate list, not an error." This
was a deliberate design decision from an earlier session ("Darren
field-test fix, Release 1, item 1"), not something built for this
brief.

**Confirmed the actual render fallback**, not just the data: in
`SelfMarkerScoreShell.tsx`, the "Choose your Playing Partner" screen
only renders when `partnerCandidates.length > 0`. For a solo group,
that's always empty — the code falls straight through to the normal
scoring UI. The separate "Waiting for [Player]" panel requires
`partnerName` to be truthy, which is never set when no partner exists
either. Neither state can trigger for a genuinely solo group,
regardless of the round's `score_capture_mode`.

**Round completion.** `checkScorecardCompletion` (`roundCompletion.ts`)
judges a digital scorecard's completion purely on
`selfHoleCount < totalHoles` — its own code comment documents that an
earlier version required marker entries to match, and that this was
deliberately removed: "a player can now genuinely reach the end of a
round with nobody having chosen to mark them at all — a normal, valid,
expected outcome." Zero dependency on a partner existing.

## SCENARIO B — SOLO PAPER PLAYER: ALREADY CORRECT

**Scorecard existence.** `begin_round()` creates a scorecard row for
every player regardless of `scoring_method` or group size — a solo
Paper player's scorecard exists exactly the same way any other
player's does.

**Score entry mechanism.** Traced `applyHoleOverride.ts` (the canonical
write path, shared by both the single-hole `override` route and the
multi-hole `batch-override` route) directly: it explicitly **inserts a
brand-new `capture_role='self'` entry when none exists** — its own
comment names this "the lost/dead phone case." This is not merely a
correction mechanism; it can build a player's entire scorecard from
nothing. The route itself is organiser-only
(`membership.data.role !== 'organiser'` returns 403 otherwise) and
targets any `scorecardId` directly, not scoped to the caller's own
card — confirmed an organiser can write every hole for a solo Paper
player who has no shared-device partner at all, using the exact same
mechanism already used for correcting any other player's scores. No
second Paper-scoring system exists or was built.

## AREA 3 — VERIFICATION/RECONCILIATION (the area flagged as most important)

Side Game verification for a solo claimant was already solved by an
earlier fix in this engagement (migration 071,
`resolve_side_comp_verifier`) — traced its final tier directly:
`self_verified_fallback`, which resolves to the claimant themselves
when genuinely no marker, shared-device partner, organiser, or
groupmate exists. This was built and tested (`resolveSideCompVerifierCandidate`'s
own "genuinely nobody else resolves to self, explicitly flagged, never
silent" test) for a different original purpose, but it is the exact
mechanism a solo group's Side Game claims need, and it already covers
this case correctly.

---

## AREA 1 & 2 — CONFIRMED, NO ACTION NEEDED

- No `group.players.length >= 2` (or similar) assumption was found
  anywhere in group creation, Group Setup, Finalize Round, Begin Round,
  or Starting Grid.
- Solo status is derived authoritatively from actual group membership
  at every point checked — never inferred from a partner failing to
  poll, join, or respond. The two guards that *do* require 2+ players
  (`markers/route.ts`'s manual marker-assignment endpoint, and two
  "who's leading" comparison guards in `tournament/route.ts` /
  `my-round/route.ts`) were checked and confirmed to be organiser-tool
  or narrative-display guards only — none of them sit in the player's
  own scoring or completion path, and none of them block a solo player
  from scoring, completing, or having their round close.

---

## WHAT THIS MEANS

No files were changed, because no genuine blocker was found to change.
This is not the same claim as "definitely works" — it's "traced
carefully, found no code-level reason it wouldn't." The one thing this
sandbox cannot do is actually run a solo round through Start Scoring,
completion, and close on a real device.

## REAL-DEVICE VERIFICATION NEEDED

1. **Scenario A**: create a genuine 1-Digital-player group, confirm
   Start Scoring goes straight to the scorecard with no partner
   UI of any kind, score a full round, confirm completion and round
   close both work normally.
2. **Scenario B**: create a genuine 1-Paper-player group, confirm the
   organiser can enter that player's full scorecard via the existing
   Score Management path, confirm it counts toward completion,
   leaderboard, and any applicable highlights correctly.
3. Confirm a solo group's Side Games (if used) resolve verification
   correctly via the self-verified fallback, on a real claim.
4. Confirm a solo group does not accidentally get excluded from
   Individual Makers & Breakers (group-scope archetypes correctly
   require 2+ members already and should simply not fire for a solo
   group, which is expected — but this is worth an explicit real-device
   look since it wasn't the focus of this investigation).

If any of these real-device checks turns up an actual problem, that's
the concrete data point to bring back — at that point I'd trace the
specific failure rather than speculate further from here.
