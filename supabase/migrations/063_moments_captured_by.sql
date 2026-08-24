-- =============================================================================
-- 063_moments_captured_by.sql
-- =============================================================================
-- Side Games proxy entry — photo ownership vs capture.
--
-- Inspected first, per the explicit instruction: moments.player_id
-- (migration 028) is the ONLY person reference on this table. For a
-- normal self-captured photo this is fine — the photographer and the
-- subject are the same person, so one column safely represents both.
-- But it cannot represent "this photo is of Mick's achievement, and
-- Alex is the one who took it" — the exact case Side Games proxy entry
-- needs (Alex enters Mick's Nearest the Pin result and photographs
-- Mick beside the marker). The existing schema genuinely cannot
-- represent that distinction; this is the smallest additive change
-- that lets it.
--
-- player_id remains authoritative for "whose achievement/story this
-- is" — every existing query that reads player_id (My Golf, Event
-- Story, the moments feed) continues to work completely unchanged,
-- since the achievement subject is still exactly what that column
-- already means. captured_by is purely additive: nullable, so every
-- existing row (all of them self-captured, photographer == subject)
-- needs no backfill and no assumption — a NULL captured_by is
-- correctly read as "same person," not as missing data.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS captured_by UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.moments.captured_by IS
  'Who actually took/uploaded this photo, when different from player_id (the achievement subject). NULL means captured_by the subject themselves — the overwhelmingly common case, and the correct default for every pre-existing row.';

NOTIFY pgrst, 'reload schema';
