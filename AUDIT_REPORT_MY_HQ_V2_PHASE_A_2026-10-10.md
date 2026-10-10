# TEEIN' IT UP — MY HQ V2, PHASE A AUDIT

**10 Oct 2026.** Per the brief's own structure, this is Phase A only —
audit before any layout change. Nothing has been modified yet. One
genuine decision point came out of it that the brief itself says needs
your approval before Phase B can build Stage 4/5 (below).

## 1. Current My HQ — what's actually there

Route: `/trips/[tripId]/tournament`.

- `page.tsx` (215 lines, Server Component) — role branch: non-organisers
  get `MyRoundClient` ("My Golf"); organisers get `EventCountdown` +
  `MyHQClient` + `AdminScoreOverridePanel`.
- `MyHQClient.tsx` (174 lines) — thin shell: round selector state, two
  CTA cards, an empty state, and mounts the real body.
- `TournamentControl.tsx` (1,190 lines) — the actual dashboard. 16
  distinct sections, 4 of its own `useQuery` calls plus 7 more spread
  across child components — **~11 independent GET queries and 7+
  mutation calls** fire to render one page.

Every one of the brief's specific clutter complaints is real, confirmed
by reading the code (not just screenshots):

- **Makers & Breakers appears four separate ways**, not two: a card
  above the dashboard (`RoundHighlightsCard`), the "Round Complete"
  card's own button, a post-close invitation card, and the published-
  highlights display further down — the first three open the identical
  `MakersBreakers` component from three different triggers.
- **Group completion data renders twice** — once as the expandable
  Group Progress list, again as a compact table inside "Score
  Management" — same underlying array both times.
- **"Score Management" is two different components sharing one
  label/anchor** — a small table inside the dashboard, and the real
  679-line `AdminScoreOverridePanel`, rendered entirely outside it.
- **"The Story" mixes scopes**, confirmed in the code's own comments:
  it merges this round's milestones with an *unscoped, trip-wide*
  Moments query — labelled as one round's story, actually part
  event-wide. A genuinely round-scoped version existed and was
  deliberately deleted in favour of this blended one.
- **Event Health sits mid-page** (after Leaderboard Snapshot and the
  entire Close Round flow), not near the top.
- **Playing Partner Status renders unconditionally**, round status
  notwithstanding — confirmed it was placed there as a side effect of
  removing an unrelated duplicate section, not a deliberate choice.
- A leftover dead query (`roundMomentsData`) still fires on every
  render with nothing reading its result.

None of this needs guessing at — it's all exactly what Section 7 of
your brief described, just confirmed against the real file.

## 2. Round chronology/selection — mostly already correct, one gap found

The canonical logic already exists in `src/lib/scoring/multiRound.ts`
(`sortRoundsChronologically`, `resolveFocusRound`,
`selectLeaderboardRound`, `resolveRequestedOrDefaultRound`) and already
implements your exact 5-tier priority order. The Round 2/Round 3 bug
you referenced was real and was fixed on 28 Aug — documented in
`DELIVERY_REPORT_MULTIROUND_2026-08-28.md` — by adding a tiebreaker to
the chronological sort and a display-name correction.

**But the fix wasn't applied everywhere.** `PlayerHomeCard.tsx` (the
player-facing Lobby view, line 290) still has the exact un-tiebroken
`sort((a,b) => a.play_date.localeCompare(b.play_date))` pattern that
caused the original bug, feeding `resolveFocusRound` with a
non-deterministic "most recently completed" round whenever two rounds
share a `play_date`. This is outside My HQ itself, but the same bug
class, still live. I'd fix this alongside the My HQ work rather than
leave a known-bad pattern sitting next to the freshly-corrected one —
flagging it here rather than just doing it, since it's a file the
brief didn't name.

Within My HQ, round identity is already single-sourced correctly
(`selected.id` flows uniformly into every child). Outside it, each
route (Leaderboard, Side Games API, the Lobby above) re-derives its own
selection independently using the shared helpers — consistent in
principle, inconsistent in practice only where a caller's own fetch
isn't tiebroken, i.e. just the one file above.

## 3. Round close / verification — safeguards identified, nothing to touch

- Round status has **no `'closed'` value** — only `upcoming` / `active`
  / `completed`. There is also **no round-close RPC** — the brief's
  "do not modify round-close RPCs" should instead read as: do not
  modify `checkRoundCompletion()`/`checkScorecardCompletion()`
  (`src/lib/scoring/roundCompletion.ts`) or the close route's own gate
  (`close/route.ts`), which perform a plain `rounds.update({status:'completed'})`
  only after that gate passes, then best-effort call the one real RPC
  in this path, `finalize_side_comp_winners`.
- **"100% of holes scored" and "scoring requirements satisfied" are
  already two separate, correctly-distinguished signals** —
  `completionPct` (hole-entry percentage) vs. `awaitingReconciliation`
  (marker/self mismatch count). The existing Close Round button
  already requires both to be clear. Stage 2/3 can reuse this exactly
  as-is; there's no "100% = complete" shortcut to guard against — it
  was never taken.

## 4. The one genuine gap: Stage 4's "reviewed vs. reviewed-and-selected-none"

This is the question the brief explicitly flagged and told me not to
resolve without asking you first, so I'm stopping here rather than
picking an answer.

**What exists today:** `published_round_highlights` — one row per
round, written only when an organiser POSTs a highlight selection.
`highlights` is `NOT NULL`, so a genuine "reviewed it, chose nothing"
publish *could* be stored as `highlights: []`. But the only signal any
caller currently checks is **row existence**, and two places already
collapse "no row" and "row with an empty array" into the same outcome:
the publish route's own `GET` handler, and
`RoundHighlightsSection.tsx`'s render guard
(`if (!publishedAt || highlights.length === 0) return null`).

**So concretely:** there is no way today to tell "organiser hasn't
looked at this yet" apart from "organiser looked and picked nothing."
Round closure itself has zero awareness of Makers & Breakers either way
— the two are completely independent, confirmed by reading the close
route in full.

**Two ways to close this gap, neither of which I've done:**

1. **A new column** — e.g. `published_round_highlights.reviewed_at
   TIMESTAMPTZ`, written the moment the organiser opens/finishes the
   Makers & Breakers screen for a round, independent of whether they
   select anything. Cleanest semantically; is a new migration.
2. **No new column — a convention instead:** always write a row on
   "finish reviewing" (even with `highlights: []`), and fix the two
   places that currently collapse "no row" into the same state as "row,
   empty" to actually check row-presence rather than array length.
   Avoids a migration entirely, but means Stage 4's "completed" state
   depends on an organiser explicitly reaching some "I'm done, even if I
   picked nothing" action in the UI — needs that affordance to exist
   (it doesn't today; the brief does ask for an explicit skip/finish
   action, so this isn't extra scope, just where the signal lives).

I'd lean towards (2) — it's smaller, no migration, and the brief
already requires a "skip/finish" action for the empty-candidates case
regardless, which is the natural place to write that row. But this is
your call, not mine to make silently, per your own brief.

## 5. Event Memories & Presentations entry point

Today My HQ's only link into Memories is `EventMemoriesCard` — a plain
nav card to `/trips/{tripId}/memories`, nothing more; no scope
selection happens from My HQ. The Memories page's own slideshow builder
already has the full round/event scope selection
(`PresentationConfig`/`getAvailableSections`, confirmed in detail during
this session's earlier V1.18 work) but **doesn't currently read any URL
parameter** to jump straight into a pre-chosen scope.

So "Create Round Presentation" / "Create Event Presentation" as two
distinct Stage 5 actions can be built as **two links into the existing
page with a new, small, additive query-param** (e.g.
`?startSlideshow=round&roundId=X` / `?startSlideshow=event`) that the
Memories page reads on load to jump straight to the builder with that
scope pre-set — not a new presentation system, not a deck-generation
change, no migration. I'm treating this as a normal Phase B
implementation detail rather than something that needs sign-off, since
it touches neither the hard-boundary list nor the schema — flagging it
here only so the approach is visible before I build it.

## 6. Permissions

Every section audited is already organiser-gated at the API layer
(role checks confirmed directly in each route touched above), consistent
with "preserve all permissions and safety controls." Nothing here
suggested a gap Phase B would need to introduce new checks for.

---

## What I need from you before Phase B

Just the one decision in §4 — new `reviewed_at` column, or the
no-migration convention fix. Once I have that, I'll move to Phase B
(the workflow-derivation component) and the layout refactor, in that
order, matching the brief's own phase structure — this is too large a
redesign to do in one pass, so I'd plan to check back in after Phase B
with the derivation logic before touching the actual page layout.
