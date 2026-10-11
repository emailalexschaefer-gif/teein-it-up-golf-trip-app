# Mobile Acceptance Checklist — Phase E
**11 October 2026 · to run on a real phone, not a desktop browser resize**

Per your own standing instruction: production readiness is gated on this
pass succeeding, in addition to a real build. 901 passing sandbox tests
confirm the logic is wired correctly; they say nothing about whether this
actually works on a phone in an organiser's hand. This phase's single
biggest structural change — the five-stage Round Control Centre — has never
been seen running in a browser at all, so treat every item below as
genuinely unverified until checked.

## Priority 1 — Round Control Centre (new this phase, highest risk)

- [ ] Open My HQ for an **upcoming** round. Confirm Stage 1 auto-opens,
      shows real group/player/handicap-missing counts (not placeholder
      text), and the "Start Round" button still routes to the Rounds tab
      exactly as before.
- [ ] Start the round. Confirm Stage 2 auto-opens instead, with the full
      live dashboard (Leaderboard Snapshot, Round Summary, Group Progress,
      Alerts, Side Games, Playing Partner Status, Live Statistics, Group
      Map) all rendering correctly **inside** the stage's expanded body.
- [ ] Manually collapse Stage 2, then wait through at least one 8-second
      live-data poll. **Confirm it stays collapsed** — a data refresh must
      never silently re-expand a stage you closed.
- [ ] Switch to a **different round** via Event Schedule. Confirm the stage
      that auto-opens is that round's own current stage, not whatever was
      left open for the previous round.
- [ ] Tap each of the five stage headers individually — confirm each
      expands/collapses independently (not an accordion that closes others).
- [ ] With the round ready to close, tap the "Close Round" primary action.
      Confirm Stage 2 **and** Stage 3 both expand and the page scrolls
      smoothly to the real Close Round control. Confirm the whole close
      flow (confirmation modal, success, post-round snapshot, Makers &
      Breakers prompt) still works exactly as before — this control's own
      code is unmoved, only its position changed.
- [ ] Once a round is completed, open Stage 4. Confirm **both** the
      selection/review tool and the published-highlights view appear
      together, and that publishing highlights there still reflects
      correctly for players in My Golf.
- [ ] Open Stage 5. Confirm Event Story and Event Memories both render with
      real data (not blank), and the "Create Presentation" action still
      deep-links into the slideshow correctly for both a single round and,
      once every round is closed, the full event.
- [ ] Within Stage 2, confirm Group Progress and Alerts behave as
      collapsible subsections — Alerts in particular should not appear at
      all when there's nothing to show, and should auto-expand the moment
      a mismatch/alert appears while you're watching.
- [ ] Score Management (below the stage tracker): confirm it still opens to
      whichever round you have selected in My HQ, and that manually picking
      a different round in its own dropdown is respected (doesn't snap back
      on the next poll) until you reselect the My HQ round.
- [ ] Scroll the whole page on a small phone screen (iPhone SE size or
      similar) — confirm nothing overflows horizontally and the fixed
      bottom nav never covers an expanded stage's content or its primary
      action button.

## Priority 2 — Tied-winner announcement

- [ ] Close a round where two (or more) players finish tied at the top.
      Confirm My HQ's "Today's Highlights" shows the new tied wording
      ("X & Y tied at the top with N points"), never "wins by 0."
- [ ] Close a round with a clear single winner. Confirm the ordinary "wins
      by N points" wording is unchanged.

## Priority 3 — Slideshow

- [ ] Build a presentation with Event Snapshot included. Confirm: the
      "EVENT SNAPSHOT" heading and the real event name both appear, no
      date is shown, all four stat columns show correct live numbers
      (including course names wrapping sensibly for a long name), and the
      logo appears top-centre, not overlapping any text.
- [ ] If the event has a genuine multi-player tie for champion, confirm the
      Event Champion column shows the real count (2+), not 1. If no
      champion is confirmed yet, confirm it shows 0, not a fabricated name.
- [ ] Check the opening slide: confirm the date range is now clearly
      legible against the bright sunrise background, and the event title
      is still the dominant element.
- [ ] Check the closing slide: confirm "What a Great Event!", both
      sublines, "My Golf" (gold/bold/underlined), and the tagline all
      render clearly, and make a judgement call on the blurred-backdrop
      trade-off described in the delivery report — if it isn't acceptable,
      say so and a clean background asset can be supplied for a crisp
      version.
- [ ] Run through the full slideshow end-to-end once on a phone — deep
      link in, manifest load, navigate forward/back through every slide
      type, and confirm nothing regressed from the Final Pre-Production
      Gate pass (no duplicate auto-launches, no misleading readiness state).

## What to report back

For each unchecked/failed item: what you saw, which round/device/browser,
and a screenshot if anything looks visually wrong. That's enough to turn
into a targeted fix — no need to diagnose the cause yourself.
