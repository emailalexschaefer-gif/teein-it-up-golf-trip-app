-- =============================================================================
-- 058_groups_released.sql
-- =============================================================================
-- Deployment 1 — "Critical: don't expose organiser drafts." Confirmed
-- no persisted "groups finalised" state exists anywhere in the current
-- schema — trip_members.group_id is written immediately the moment an
-- organiser assigns someone in TripGroupsTab, with nothing distinguishing
-- "still being built" from "ready for players to see."
--
-- Smallest robust additive mechanism, not a new event lifecycle: one
-- boolean on trips (groups are a trip-wide entity today — confirmed via
-- trip_members.group_id, a single non-round-scoped column — not a
-- separate concept to invent here). Defaults false, so every EXISTING
-- trip is unaffected until an organiser explicitly releases groups —
-- no retroactive "surprise" reveal for a trip already mid-event.
--
-- This does not change trip_groups or trip_members at all — group
-- assignment itself is completely untouched. This is purely a
-- visibility gate the player-facing UI checks before showing group
-- membership (Starting Grid, My Round's "My Group" section).
-- =============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS groups_released BOOLEAN NOT NULL DEFAULT false;
