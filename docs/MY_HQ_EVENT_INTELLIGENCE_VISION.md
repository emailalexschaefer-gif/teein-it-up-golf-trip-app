# My HQ — Event Intelligence Vision (Future Sprint, not yet built)

**Status: vision/planning document only.** Nothing in this file has been
implemented. Captured here so the direction isn't lost before its sprint
comes up. Do not treat any section below as a task list for the current
build — it's the target shape for a later, dedicated sprint, to be done
after the core organiser flow (round lifecycle, reconciliation, Round
HQ's operational sections) is complete and stable.

## Core philosophy

> My HQ should tell the organiser the story of the event, not overwhelm
> them with data.

Three questions every My HQ card must answer. If a card can't answer one
of these, it doesn't belong in My HQ:
1. Is the event running smoothly?
2. Does the organiser need to do anything?
3. What are the biggest stories happening today?

## My HQ evolves through three stages, not a static screen

- **Before play** — round readiness (players, groups, tee times,
  handicaps, scorecards), Start Round.
- **During play** — Round Health, Timeline, Leaderboard Snapshot, Side
  Game Snapshot, Alerts, Live Statistics, Quick Actions.
- **After play** — Final Results, Winners, Event Statistics, Highlights,
  Moments, Share Results.

The page should visibly transition between these, not just conditionally
render the same layout with different data.

## Timeline — milestones, not an activity log

Explicitly **not** every hole completion or score submission (the current
Round HQ implementation's timeline, built from `score_entries.entered_at`,
is a reasonable *operational* log for now — this vision describes a
different, curated *narrative* timeline for later, not a replacement of
today's implementation without a redesign pass).

Only meaningful milestones:
- Round lifecycle: 🟢 Round Started, 🏁 Final Group Finished, 🏆 Results
  Published.
- Leaderboard: only genuine lead changes — 🥇 takes the lead, 🔄 moves
  into first, 🏆 secures the win. Not every position shuffle.
- Side games: 🎯 new leader, 💥 Longest Drive changes hands, ⛳ hole-in-one,
  🏆 winner confirmed.
- Reviews: ⚠️ review required, ✅ review resolved.
- Moments (once built): 📸 notable uploads, e.g. "Darren uploaded a birdie
  photo (Hole 8)."

This requires genuine "is this significant" logic — e.g., detecting a
*lead change* specifically, not just any points update — which doesn't
exist yet and would need real design work, not just a UI change.

## Live Statistics — a snapshot, not a stats dump

Three groups only, not dozens of metrics:
- **Scoring:** birdies, eagles, hole-in-ones, average Stableford, average
  gross.
- **Side Games:** Nearest the Pin entries, Longest Drive entries, side
  games completed.
- **Event:** players finished, average pace of play, Moments captured.

(Birdies/pars/bogeys/avg Stableford/best-hole/hardest-hole already exist
in the current Round HQ's stats section — eagles, hole-in-ones, average
gross, and pace of play would be new computations.)

## Today's Highlights — the signature section

Reads like the talking points people discuss over a drink afterward, not
raw numbers:
> 🏆 Alex wins by 2 Stableford points. 🎯 Darren claims Nearest the Pin.
> ⛳ 37 birdies recorded today. 🦅 Two eagles recorded. 📸 26 Moments
> captured. 🔥 Biggest comeback: Mark climbed 7 leaderboard positions.
> 💥 Longest Drive: 312 metres.

This needs "biggest comeback" logic (tracking a player's position history
across the round, not just final vs. start) — genuinely new, not derivable
from anything currently stored.

## Leaderboard Snapshot

Top 5 only, plus a "View Full Leaderboard" button — never duplicate the
full leaderboard inside My HQ.

## Side Game Snapshot

Quick status per competition (✔ Complete / Waiting for Group N), tap to
open Side Games. Depends on Side Games (Sprint 5C.3) existing first.

## Alerts — actionable only

⚠️ Hole 11 requires review, ⚠️ Marker mismatch, ⚠️ Player offline. If
clear: ✅ No active alerts. (The mismatch/waiting-group alerts in the
current Round HQ already follow this "actionable only" principle — this
vision adds "player offline" detection, which doesn't exist yet and would
need a presence/heartbeat mechanism.)

## Quick Actions

Start Round, Close Round, Publish Results, Message Players, Edit Groups,
Add Player. Per the standing rule already established for Round HQ: only
ever show an action that has a real handler behind it — no dead buttons.
"Message Players" depends on Chat existing first.

## Relationship to Moments

My HQ is **not** the permanent home of Moments — that's its own dedicated
area per event. My HQ only surfaces the most important moments (via
Timeline and Highlights) while the round is live.

## Long-term product direction

> Organise the event, run the event, celebrate the event, remember the
> event.

The scoring engine remains the foundation; this experience layer is the
product's differentiation on top of it.

## What this depends on, not yet built

Side Games (5C.3), Chat, Moments/media upload, a genuine event/lead-
change detection layer, a presence/pace-of-play mechanism, and a curated
(not raw) timeline model distinct from today's `entered_at`-based log.
None of these should be assumed to exist when this sprint is scoped.
