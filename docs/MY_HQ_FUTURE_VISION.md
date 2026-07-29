# My HQ Experience & Event Intelligence — Future Sprint (vision only, not built)

Status: **deferred**. Captured here so the direction isn't lost, to be
scheduled after the core organiser flow (round HQ, group progress,
reconciliation, leaderboard) is complete and stable. Nothing in this
document has been implemented — see "Current state" at the bottom for
exactly what exists today versus what this describes.

## The core philosophy

> My HQ should tell the organiser the story of the event, not overwhelm
> them with data.

Every card should answer one of three questions. If it doesn't, it
doesn't belong in My HQ:
1. Is the event running smoothly?
2. Does the organiser need to do anything?
3. What are the biggest stories happening today?

## My HQ evolves through three stages, not one static screen

**Before play** — Round readiness, players, groups, tee times,
handicaps, scorecards, Start Round.

**During play** — Round Health, Timeline, Leaderboard Snapshot, Side
Game Snapshot, Alerts, Live Statistics, Quick Actions.

**After play** — Final Results, Winners, Event Statistics, Highlights,
Moments, Share Results.

## Timeline philosophy — a critical constraint

The Timeline must **not** become an activity log. Do not record every
completed hole or every score submission — that already exists today
(the current build's timeline shows recent confirmed scores; the future
version should replace this with milestone-only entries). Record only
things that help tell the story of the day:

- Round lifecycle: 🟢 Round Started, 🏁 Final Group Finished, 🏆 Results
  Published.
- Leaderboard changes: only genuine lead changes (🥇 takes the lead, 🔄
  moves into first, 🏆 secures the win) — never every position shuffle.
- Side game events: new leaders, first hole-in-one, winner confirmed.
- Review events: score review required / resolved.
- Moments (once built): photo/video uploads become timeline entries too.

## Today's Highlights — a signature section

Not raw stats — the talking points people discuss after the round.
Example tone: "Alex wins by 2 Stableford points," "37 birdies recorded
today," "Biggest comeback: Mark climbed 7 leaderboard positions." This
is explicitly described as one of the sections that should define the
product's personality, not a generic stats dump.

## Section-by-section scope discipline

- **Leaderboard Snapshot**: top 5 only + "View Full Leaderboard" button.
  Never duplicate the full leaderboard inside My HQ.
- **Side Game Snapshot**: status only (✔ Complete / Waiting for Group 4),
  tap through to Side Games — not the full results inline.
- **Alerts**: actionable items only, or "✅ No active alerts." Never a
  list of non-actionable informational noise.
- **Live Statistics**: a small, curated set (birdies, eagles, hole-in-
  ones, avg Stableford/gross; side-game entry counts; players finished,
  pace, moments captured) — explicitly "do not overload with dozens of
  metrics."
- **Quick Actions**: Start Round, Close Round, Publish Results, Message
  Players, Edit Groups, Add Player — same principle already established
  in the current build: only real, wired actions, never a dead button.

## Relationship to Moments

My HQ is not Moments' permanent home. Moments gets its own dedicated
area per event; My HQ only surfaces the most important ones (via
Timeline milestones and Highlights) while the round is live.

## Long-term product vision

> Teein' It Up should evolve beyond scoring — organise the event, run
> the event, celebrate the event, remember the event. The scoring engine
> remains the foundation; the experience surrounding it becomes the
> product's true point of difference.

## Current state, for whoever picks this up later

What exists today in `TournamentControl.tsx` / the `tournament` API route
already covers a meaningful subset, but not in the "story, not data"
shape this document describes:

- **Timeline** — currently the 15 most recent confirmed score entries,
  literally an activity log. This is exactly what this future sprint
  says to move away from. Rebuilding it as milestone-only (lead changes,
  round start/finish, review resolved) is the single highest-value
  change this future sprint describes.
- **Live Statistics** — birdies/pars/bogeys/avg Stableford/best-hole/
  hardest-hole already exist and mostly match the curated spirit here;
  eagles and hole-in-ones are not yet broken out as their own counts.
- **Alerts** — already actionable-only with a "no issues" fallback state,
  already matches this document's intent.
- **Leaderboard Snapshot / Side Game Snapshot / Today's Highlights /
  stage-based (before/during/after) layout** — none of these exist yet.
  My HQ currently shows one static layout regardless of round stage.
