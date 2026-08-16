-- =============================================================================
-- 053_round_group_tee_times.sql
-- =============================================================================
-- Priority 5 — round-specific tee times. Root cause (diagnosed earlier
-- this session, documented in TESTING.md): trip_groups.tee_time is
-- trip-wide, shared identically across every round — there was
-- genuinely no dimension in the schema for "this group's tee time on
-- this specific round". This migration adds exactly that, and nothing
-- else — trip_groups itself is untouched (group identity/membership/
-- Leaders Last reordering logic all keep working exactly as before;
-- only the TIME dimension becomes round-scoped).
--
-- No cross-round fallback by design: a round with no row here for a
-- given group has no tee time to show, and must display as unset —
-- never silently inheriting a prior round's time. That's enforced by
-- simply not having a default/inherited value anywhere in this schema,
-- not by application-level logic that could be bypassed.
--
-- Changing Round 2's time can never rewrite Round 1's — each row is
-- keyed by (round_id, group_id), so a Round 2 UPDATE can only ever
-- match a Round 2 row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.round_group_tee_times (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  group_id   UUID        NOT NULL REFERENCES public.trip_groups(id) ON DELETE CASCADE,
  tee_time   TEXT        NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, group_id)
);

CREATE INDEX IF NOT EXISTS round_group_tee_times_round_idx ON public.round_group_tee_times(round_id);

ALTER TABLE public.round_group_tee_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members: view" ON public.round_group_tee_times
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_tee_times.round_id
        AND public.is_trip_member(r.trip_id)
    )
  );

CREATE POLICY "Organisers: manage" ON public.round_group_tee_times
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_tee_times.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_tee_times.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );
