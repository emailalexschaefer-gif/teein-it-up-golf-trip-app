# Performance & Native-Feel Sprint — Plan (not built this pass)

Status: **planning document only**, per the framing of the request itself
("I would add a dedicated sprint before the major pilot... I would
seriously consider doing this after the current bugs are fixed"). Given
the scale of what's described here — app-shell architecture, broad
caching changes, realtime subscriptions — starting a wide rearchitecture
without being explicitly asked to build it this turn felt like the wrong
call. This document captures the plan and, where possible, confirms what
already holds true today, so nothing here needs re-investigating from
scratch when this sprint is actually scheduled.

## Item 1 — Keep the app shell mounted: ALREADY TRUE TODAY, verified

Checked, not assumed: `src/app/(app)/trips/[tripId]/layout.tsx` already
wraps every route under a trip — the trip page, Leaderboard, Side Games,
My HQ, Chat, and the scoring pages under `rounds/[roundId]` — as a single
Next.js layout tree. Next.js App Router does not remount a layout when
navigating between sibling routes nested under it; only the page content
inside re-renders. That means `DesktopTripNav` and `TripBottomNav`
already stay mounted across every one of these tab transitions today,
with no additional work needed for the specific "don't rebuild the shell"
goal. If tab switching still *feels* like a full reload in testing, the
cause is more likely items 2/3 below (data refetching from scratch on
each page) than the shell itself remounting.

## Item 2 — Cache previously loaded data / stale-while-revalidate

Partially true already: every data-fetching component in this app
(`LiveLeaderboard`, `TournamentControl`, `EventMessages`) already uses
React Query, which does cache by query key and can serve stale data
instantly while refetching in the background — but most of these are
currently configured with `staleTime: 0`, which defeats that benefit by
treating cached data as immediately stale. A real fix here is narrow and
low-risk: raise `staleTime` on read-heavy, less time-critical queries
(e.g. group/player/handicap data that rarely changes mid-round) while
keeping `staleTime: 0` where genuine freshness matters (mismatch alerts,
chat). This is the single highest-value, lowest-risk item in this whole
plan — small, targeted config changes, not an architecture change.

## Item 3 — Optimistic updates beyond scoring

Score confirmation already has a real optimistic-update pattern (local
Dexie queue + immediate UI update, syncs in the background) — this
already exists and works. Extending the same *pattern* to chat send,
reconciliation resolution, and group editing is plausible but each is a
separate, real piece of work — chat's `EventMessages.tsx` already does a
lightweight version of this (shows the real returned message immediately
via `setQueryData`, doesn't wait for the background invalidate). Alert
resolution and group editing do not have this yet.

## Item 4 — Split My HQ into independently-refreshable sections

Real, moderate-complexity work: `TournamentControl.tsx` currently fetches
its entire payload as one `useQuery` call and re-renders the whole
component on every refetch. Splitting Event Health / Group Progress /
Alerts / Leaderboard Snapshot / The Story into separately-fetched pieces
would let resolving one mismatch refresh only the affected section — but
this means splitting one API route into several, or having the client
extract sub-slices from one response without re-rendering unaffected
children (memoization). Worth scoping as its own focused piece, not a
quick win.

## Item 5 — Prefetch likely next screens

Straightforward with React Query's `prefetchQuery`, callable from
`TripBottomNav` on hover/touch-start of an adjacent tab. Low complexity,
real value, not yet built.

## Item 6 — Realtime updates via Supabase Realtime

The largest, riskiest item in this plan. Nothing in this codebase
currently uses Supabase Realtime (Postgres change subscriptions,
websockets) — every live-feeling update today is polling or client-
triggered invalidation. Adding Realtime means: enabling replication on
specific tables, new subscription-management code with proper cleanup
(a leaked subscription is a real bug class), and deciding how it
interacts with the existing polling (redundant polling alongside
realtime wastes requests; removing polling entirely removes the fallback
if a realtime connection drops). This deserves its own dedicated,
carefully-tested pass — not a bullet point folded into a broader sprint.

## Item 7 — Avoid repeated heavy calculations

The tournament route's Story/Highlights computation (checkpoint-based
lead-change detection, worst-vs-final rank) already re-runs in full on
every request today. Genuine caching here (memoizing per round, only
recomputing when new score entries exist) is real, moderate work — worth
profiling first to confirm it's actually a bottleneck before optimizing,
since the current computation is O(entries) and this app's realistic
player counts are small.

## Suggested sequencing, if/when this sprint is scheduled

1. Item 2 (staleTime tuning) — smallest, safest, immediate feel
   improvement.
2. Item 5 (prefetch adjacent tabs) — small, real value.
3. Item 4 (split My HQ sections) — moderate, meaningful for the exact
   "resolve one mismatch, only that section refreshes" goal described.
4. Item 3 (extend optimistic updates to chat/alerts/groups) — moderate,
   per-surface work.
5. Item 6 (realtime) — largest, do last and in isolation, with its own
   dedicated testing pass given the new failure modes it introduces
   (dropped connections, subscription leaks, interaction with existing
   polling).

## Explicitly not started this pass

Nothing in items 2–7 was implemented — this is a planning document only,
consistent with the sprint recommendation being framed as "before the
major pilot" and "after the current bugs are fixed," not "build this
now."
