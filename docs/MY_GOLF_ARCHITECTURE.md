# My Golf — Future Architecture (documentation only, not built this pass)

This document exists per the Sprint 5C polish brief's explicit instruction
to design new event/result/media structures so they can later feed into
My Golf, without building My Golf itself in this pass.

## What My Golf answers

> "What have I played, achieved, and experienced over time?"

It is the user's personal, long-term archive — distinct from **My HQ**
(the live, in-the-moment operating centre for the round happening right
now) and **Moments** (the shared, per-event feed everyone in that event
sees). My Golf is private-to-the-user and spans every event they've ever
played, organised, or captured moments in.

## Relationship to existing/new structures

Nothing in this pass creates a `my_golf` table or route. Instead, the
data My Golf will eventually read already has (or will soon have) a home:

| My Golf will show | Sourced from |
|---|---|
| Completed events | `trips` where the user has a `trip_members` row, `status = 'completed'` |
| Score history | `scorecards` + `score_entries` (already exists — used by leaderboard, tournament routes) |
| Personal statistics (avg Stableford, best/worst rounds) | Same tables — the tournament route's stats section (`birdies`/`pars`/`bogeys`/`avgStableford`) is a per-round version of exactly this computation; My Golf would aggregate it across rounds instead of one |
| Wins and placings | Leaderboard route's `position` field, recorded at round completion |
| Side-game wins | Future `side_game_results` table (Sprint 5C.3 — not built yet) |
| Photos and videos | Future `moments` table (see below) |
| Friends/groups played with | `trip_members` + `trip_groups` across the user's trip history |

## Moments — the future table (documented, not created)

Per the architecture brief, a future `moments` table would need roughly:

```
id                 uuid, pk
trip_id            uuid, fk -> trips
round_id           uuid, fk -> rounds, nullable
hole_number        int, nullable
uploader_profile_id uuid, fk -> profiles
media_type         text ('photo' | 'video')
storage_path       text
thumbnail_path     text, nullable
caption            text, nullable
captured_at        timestamptz
created_at         timestamptz
side_game_type     text, nullable
visibility         text (event-scoped by default)
moderation_status  text, if needed
```

Player tags as a separate relational table, not a comma-separated
column, per the brief:

```
moment_tags: moment_id uuid, profile_id uuid
```

RLS direction (not implemented yet): only event participants (trip
members) can view; only trip members can upload; uploader or organiser
can delete; organiser can moderate; completed events remain viewable to
former participants.

## What was actually built this pass, and why it's compatible

- **Avatar storage** (migration `024_avatar_storage.sql`) establishes the
  first real Supabase Storage bucket in this project, with an RLS pattern
  (owner-scoped folder, public read) that a future `moments` bucket would
  follow almost exactly — same shape, different bucket name and folder
  key (event/round scoped instead of user scoped).
- **My HQ's Moments placeholder** (`TournamentControl.tsx`) is positioned
  as its own section, matching where the brief wants the primary capture
  entry point to eventually live — so wiring in real upload later is an
  addition to an existing section, not a new screen.

## Explicitly not built this pass

Moments upload/capture, the `moments` table, side-game results, and the
My Golf screen itself. Per the brief: "Do not fully build My Golf... Do
not attempt the full media platform in one uncontrolled change."
