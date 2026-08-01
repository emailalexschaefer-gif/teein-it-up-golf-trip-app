# Performance & Native-Feel Sprint — Vision (not started)

Status: **captured, not implemented**. The framing of this discussion
("I would seriously consider doing this performance pass *after* the
current bugs are fixed," "a dedicated sprint before the major pilot")
reads as forward planning rather than an immediate build instruction, so
this document preserves the direction rather than jumping into a
large, loosely-scoped implementation. Say the word and this becomes the
next active sprint.

## The core principle

> The issue is not "native apps are fast, web apps are slow." A properly
> built PWA can feel very close to native. The difference is whether the
> app reloads routes unnecessarily, waits for the server before showing
> changes, discards already-loaded data, refetches too much, or renders
> too much of the page again.

## What already exists as partial groundwork (checked, not assumed)

- **Optimistic-adjacent behavior already shipped**: score confirmation in
  `SelfMarkerScoreShell` already calls `queryClient.invalidateQueries()`
  immediately after a successful local queue write (not waiting for the
  8s poll) for both the `tournament` and `leaderboard` query keys. This
  is an *invalidate-and-refetch* pattern, not true optimistic UI (the
  local capture-map state already updates instantly via `setMySelf`/
  `setPartnerMarker` before the network call, which covers the
  player's own screen; it's the *organiser's* My HQ/leaderboard that
  benefits from the invalidation).
- **Chat already does real optimistic updates**: `EventMessages.tsx`
  uses `queryClient.setQueryData()` to prepend the real server-returned
  message immediately after a successful send, before the background
  invalidate settles — this is the actual pattern item 3 (optimistic
  updates) describes, already applied to one surface. It could be
  extracted into a shared helper and reused for reconciliation and side
  competitions once those exist.
- **React Query is already the caching layer** throughout (leaderboard,
  tournament/My HQ, event messages, groups) — the "cache round/event
  data, stale-while-revalidate" direction isn't a new library to adopt,
  it's configuring the query client's `staleTime`/`gcTime` more
  deliberately than the current per-query `staleTime: 0` almost
  everywhere (which is currently correct-but-conservative: always treats
  data as stale, always refetches on mount/focus — safe, but exactly the
  "returning to a screen shows a loading state instead of instant cached
  data" behavior item 2 wants fixed).
- **The bottom nav (`TripBottomNav`)/layout (`trips/[tripId]/layout.tsx`)
  already persists across Scorecard/Leaderboard/Side Games/My HQ/Chat**
  navigation — but each destination is a separate Next.js *route*
  (`/trips/[tripId]/leaderboard`, `/tournament`, etc.), not a client-side
  tab switch within one mounted shell. Item 1 ("keep the app shell
  mounted... only the centre content should change") would mean
  restructuring these from separate routes into client-side view
  switches within one persistent layout — a genuinely different
  navigation architecture from what exists today, not a small tweak.

## What each item would actually require (rough sizing, not a plan)

1. **Keep the app shell mounted** — architectural change: convert
   route-based navigation between Scorecard/Leaderboard/Side Games/My
   HQ/Chat into client-side state within one persistent layout, or adopt
   Next.js parallel routes/intercepting routes to avoid full page-tree
   remounts. Biggest single change on this list.
2. **Cache previously loaded data** — mostly React Query config: raise
   `staleTime` deliberately per query (round/hole/player/group/handicap
   data changes rarely mid-round; leaderboard/My HQ change often) instead
   of the current uniform `staleTime: 0`, paired with
   `refetchOnMount: 'always'` only where genuinely needed.
3. **Optimistic updates everywhere** — extend the pattern already proven
   in chat to reconciliation, side-competition entry (once built), and
   alert resolution, with rollback on failure.
4. **Section-level My HQ refresh** — split `TournamentControl`'s single
   `useQuery` into per-section queries (Event Health, Group Progress,
   Alerts, Leaderboard Snapshot, Story) so resolving one mismatch
   invalidates only the affected section's query key, not the whole
   payload. Note: The Story/Highlights section's checkpoint-replay logic
   would need to stay consistent with Group Progress if split apart —
   worth designing carefully so the two don't drift out of sync.
5. **Prefetch adjacent tabs** — `queryClient.prefetchQuery()` calls
   triggered from wherever the user currently is, for the query keys the
   likely-next screen would need.
6. **Realtime for urgent events** — genuinely new infrastructure: Supabase
   Realtime channel subscriptions (chat messages, reconciliation
   resolution, round status changes, results published). This is the one
   item that isn't a refinement of something already in place — it's a
   new subsystem, and the one most likely to need its own careful RLS/
   channel-scoping design (mirroring the message-visibility rules already
   built for `event_messages`).
7. **Avoid repeated heavy recomputation** — the tournament route's Story/
   checkpoint-replay and stats computation currently reruns from scratch
   on every poll; memoizing or incrementally updating this (vs. full
   replay every 8s) would matter most once section-level refresh (item 4)
   exists, since sections would poll independently at different rates.

## Suggested order, if/when this becomes the active sprint

Items 2 and 3 (cache tuning, optimistic updates) are the highest
value-to-risk ratio — mostly configuration and extending an already-
proven pattern, low risk to existing scoring/reconciliation logic. Item
6 (realtime) is the largest net-new subsystem and probably deserves its
own focused pass rather than bundling with the others. Item 1 (persistent
shell) is the biggest structural change and the one most likely to
surface unexpected interactions with the Scoring Anchor, deep-linking,
and My HQ's own data-loading — worth doing after 2/3/4 are solid, not
before.
