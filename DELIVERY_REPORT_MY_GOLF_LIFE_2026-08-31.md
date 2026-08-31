# MY GOLF ACHIEVEMENTS, BADGES & EVENT HISTORY
## Delivery Report — 31 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run, and **there is
still no live Postgres connection** to execute anything against a real
database. All 7 TypeScript/TSX files touched syntax-check with **zero
errors**. Full test suite: **372/372 pass** (251 scoring + 59
highlights + 8 analytics + 54 trips, including 6 new).

---

## 1. Audit first — what's canonical, what's not

Traced every system named in item 1 before writing anything:

- **Home My Golf summary** (`MyGolfSummaryCard.tsx`) — canonical for
  the four headline numbers, backed by `/api/me/golf-summary`
  (migration 068's RPC, built in the previous round).
- **Badges / highlights** — `published_round_highlights` (migration
  066) is the one genuine, permanent, organiser-curated record. Its
  JSONB `Highlight` shape already carries `playerId` + `category`
  (serves as badge type) + `icon`/`title`; the row itself already
  carries `round_id`/`trip_id`. **No schema change was needed for
  round-level badges** — see item 16 below for the one real gap found.
- **Event Story** — `MyGolfEventStory.tsx` (an earlier round), backed
  by `/api/trips/[tripId]/final-results`. Left completely untouched;
  nothing in this round reimplements it.
- **Event Makers & Breakers** — `eventMakersBreakers.ts`, computed live
  on demand, never persisted anywhere (confirmed — see item 16).
- **Side Game results** — `side_comp_lead_changes`, already the
  established "genuine leadership change" log, reused again (third
  time now, after migration 068 and the earlier Side Game Moment fix)
  rather than a fourth win-detection implementation.
- **Player memberships/results** — `trip_members`, `scorecards`,
  `score_entries`, all already the authoritative sources used
  elsewhere.

**Nothing in this round builds a parallel version of any of these.**

## 2/3. New hierarchy + My Achievements — one canonical calculation

`MyAchievementsSection.tsx` (new, top of My Golf) calls the **exact
same** `/api/me/golf-summary` endpoint and React Query `queryKey`
(`['my-golf-summary']`) as the Home card. If both happen to be mounted
in the same browser session they'd share one cached result. This isn't
"two implementations that happen to agree" — it's structurally the same
call, so they cannot disagree. Shows all four numbers (Events, Badges,
Event Wins, Side Game Wins) in a 2×2 grid, matching your example
layout.

## 4/5/6/8. My Badges — type vs. instance, kept structurally separate

`MyBadgesSection.tsx` + `/api/me/badges`:

- **Badge type** (career collection): `🧊 Iceman ×5`, grouped and
  counted server-side, sorted by count (most-earned first).
- **Badge instance** (specific memory): only rendered once a type is
  tapped open — course + date, resolved via the existing `round_id`/
  `trip_id` foreign keys, **not duplicated strings on the badge row
  itself**, exactly per the explicit "prefer canonical references"
  instruction.
- Tapping an instance deep-links to `/trips/{tripId}/tournament` — the
  trip's existing Event Story destination. For a genuinely completed
  trip this lands on the real Event Story; for a trip that's still
  technically live (a badge earned in an earlier round of a still-in-
  progress multi-round event), it gracefully lands on that trip's
  current state instead — never a broken link, never a fabricated
  "Story" for an event that hasn't finished.

## 9/10. My Event Stories — a lightweight index, not a rebuild

`MyEventStoriesSection.tsx` + `/api/me/event-stories` — a
chronological list of the player's completed trips (name, courses,
date range, badge count, side game win count), each linking to the
same existing Event Story destination. This route deliberately returns
**only** index-level data — it never fetches or renders the rich
final-results payload itself; that only loads when the player actually
taps into one specific trip, per item 17.

## 11/12. Current/Upcoming Golf — repositioned, not rebuilt

`MyRoundClient.tsx` — the existing `RoundSchedule`/`PlayerRoundView`
experience is **completely unchanged internally**, just moved beneath
the new sections and given its own "Current / Upcoming Golf" heading.
Since "View My Golf →" already routed to this same component/route,
reordering what renders first inside it is the entire fix for item
12 — a player now sees My Achievements, then My Badges, then Event
Stories, before ever reaching the round schedule. No routing change
was needed.

## 13. Home card contrast — found and fixed a real, concrete bug

The headline numbers (`24 / 23 / 3`) were rendered in `#14532d` — the
card's *own dark-green background colour* — effectively invisible
against the gradient it sits on. This wasn't a subtle contrast tuning
issue; it was a genuine copy-paste bug (the colour clearly belonged to
a light-background context elsewhere in the app). Fixed to solid white,
bold, per your exact spec. Labels (`EVENTS`/`BADGES`/`WINS`) were
`#7a7260`, a muted brownish-grey also tuned for a light background —
fixed to warm cream (`#f5e6b8`). "View achievements" bumped from 85%
to full-opacity gold. Everything else you listed (heading, expanded
row text, expanded values, latest-achievement highlight) was already
correctly gold/white/cream — confirmed by direct inspection, not
assumed, and left unchanged.

---

## 16. DATA INTEGRITY — the mandatory finding, reported as instructed

**What exists today:** `published_round_highlights` is a genuine,
permanent, organiser-published record with everything needed for
round-level badge instances — player, badge type (`category`), event
(`trip_id`), round (`round_id`), and course/date resolvable via those
same foreign keys. **This is sufficient, with no schema change, for
every round-level badge shown in this feature.**

**What is missing:** event-level Makers & Breakers
(`eventMakersBreakers.ts` — the whole-event archetypes like "Hot
Start," "The Improver," etc., built in an earlier round) have **no
persistence layer anywhere in this schema** — confirmed by searching
every migration for any reference to them; there is none. They are
computed fresh, in memory, every single time Final Results loads, and
never stored. An event-level achievement genuinely cannot become a
permanent, traceable "badge instance" today — there is nothing to
query for it once the request that computed it ends.

**The smallest clean schema change that would close this gap**, if
wanted in a future round: a `published_event_highlights` table,
structurally identical to the existing `published_round_highlights`
(one row per completed trip, a JSONB `highlights` array, `trip_id`
only — no `round_id`, since these are whole-event archetypes) —
persisted the same way, at the same moment (organiser publish action,
or automatically once `eventFullyComplete` is first detected). This
is a genuine design decision for you to make, not something I
implemented in this pass — it wasn't requested, and per the explicit
"do not implement future systems," I did not build it speculatively.

**Can historical event-level badges be safely backfilled if that table
is added later?** Yes, in principle — `generateEventMakersAndBreakers`
is a pure, deterministic function of already-stored round data
(`scorecards`/`score_entries`/`holes`), so it could be re-run against
every historical completed trip to backfill this table once it exists.
Not attempted in this pass.

**What this round's "My Badges" feature actually shows, honestly:**
round-level badges only. A player's whole-event achievements (if any
were ever surfaced in the Final Results / My Golf Event Story banner
elsewhere) are not part of the permanent badge collection yet — this
is a real, disclosed scope boundary, not an oversight.

## 17. Performance

- `/api/me/badges` — one query (with two embedded joins) plus one
  small membership-scoping query, not one query per badge type or
  instance.
- `/api/me/event-stories` — four queries total, run in parallel via
  `Promise.all`, covering every one of the player's completed trips at
  once — not one query per trip.
- Neither route ever loads a trip's full final-results/Event Story
  payload; that only happens when the player taps into one specific
  trip, via the existing, unchanged endpoint.

---

## FILES CHANGED

- `src/components/trips/MyGolfSummaryCard.tsx` — contrast fix (item 13)
- `src/app/api/me/badges/route.ts` (new)
- `src/app/api/me/event-stories/route.ts` (new)
- `src/components/scoring/MyBadgesSection.tsx` (new)
- `src/components/scoring/MyEventStoriesSection.tsx` (new)
- `src/components/scoring/MyAchievementsSection.tsx` (new)
- `src/components/scoring/MyRoundClient.tsx` — reordered per the new
  hierarchy

## MIGRATIONS REQUIRED: No.

Genuinely none — the entire round-level badge feature runs on the
existing `published_round_highlights` schema, exactly as item 7's
"prefer canonical references... rather than unnecessarily duplicating"
instruction hoped for. (See item 16 above for the one thing that
*would* need a migration, deliberately not built this round.)

## TESTS

No new automated tests this round beyond the 6 already added for
`selectMostRecentTrip` in the previous round (still passing, still
reused unchanged here) — the new work is API-route aggregation logic
and component structure, not new pure functions. Full suite: **372/372
pass** (251 + 59 + 8 + 54), confirmed via the trips directory's full
54-test run, properly executed in its real project location this time
(not the ad-hoc relocation approach that produced a false-positive
failure in the previous round) — every temporary transpiled `.js` file
was cleaned up afterward, confirmed via `find` across `src/`.

---

## WHAT STILL NEEDS VERIFICATION

1. **Neither new route nor the existing RPC has ever executed against a
   real database** — this remains the single biggest gap across both
   rounds of this feature. Please run migration 068 (previous round)
   and sanity-check both new endpoints against a real player with
   genuine badge/event history.
2. Mobile layout review of the three new My Golf sections and the
   contrast fix — nothing here was visually tested on a device.
3. Whether the badge-instance deep-link behavior (landing on a
   still-live trip's current state rather than a finished Event Story,
   for a badge earned in an earlier round of a multi-round event still
   in progress) feels right in practice.
