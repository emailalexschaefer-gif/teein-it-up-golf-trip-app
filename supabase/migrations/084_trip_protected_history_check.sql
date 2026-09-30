-- =============================================================================
-- 084_trip_protected_history_check.sql
-- =============================================================================
-- P0 Permanent Delete safety gate (10 Sep).
--
-- CORE PRODUCT RULE this function exists to enforce: a trip may be
-- permanently deleted only when it never became a genuinely PLAYED
-- Event -- configuration alone (name, dates, courses, rounds, tees,
-- Side Game setup, an organiser membership row) must never be enough
-- to make an Event undeletable, but ANY sign of real participation or
-- history must make it permanently protected, even while Archived
-- indefinitely.
--
-- SIGNALS CHOSEN, and why each is authoritative rather than assumed --
-- traced from the real schema before writing this, not inferred:
--
--  1. A non-organiser trip_members row. Creating a trip auto-creates
--     exactly one 'organiser' row -- confirmed this alone must not
--     block deletion, per the explicit "that alone must NOT make
--     every newly-created Event undeletable" instruction. Any row
--     with role <> 'organiser' means someone genuinely joined.
--
--  2. Any scorecards row for one of the trip's rounds. scorecards are
--     only ever created when a round actually begins (begin_round()),
--     never at trip/round configuration time -- so this is the
--     authoritative "scoring has commenced" signal. score_entries and
--     marker entries are NOT checked separately: score_entries.
--     scorecard_id is NOT NULL REFERENCES scorecards(id) ON DELETE
--     CASCADE (confirmed directly against the schema), so it is
--     structurally impossible for a score_entries row to exist
--     without a scorecards row already existing -- checking the
--     parent is sufficient and avoids a brittle, redundant checklist.
--
--  3. Any side_comp_entries row for one of the trip's side_comps.
--     Confirmed this does NOT cascade from scorecards at the schema
--     level (side_comp_entries.side_comp_id references side_comps,
--     not scorecards) -- checked independently rather than assumed
--     covered by signal 2.
--
--  4. Any side_comp_lead_changes row. Also references side_comps
--     directly, not side_comp_entries -- checked independently as
--     defence in depth, even though a lead change should never exist
--     without a corresponding entry in normal operation.
--
--  5. Any moments row for the trip. Confirmed moments.round_id is
--     NULLABLE (ON DELETE SET NULL) -- a Moment can exist with no
--     round at all (a general Event photo posted before any round
--     starts), so this is a genuinely independent signal, not implied
--     by signal 2.
--
--  6. Any event_messages row for the trip. References trips directly,
--     independent of every other signal -- included per the brief's
--     own conservative instruction to err toward preserving history;
--     a deliberate organiser announcement or chat message is treated
--     as history worth protecting, not disposable setup noise.
--
--  7. Any published_round_highlights row for the trip. Publishing
--     requires a round to have generated real highlights from real
--     scores, which implies signal 2 -- checked explicitly anyway as
--     defence in depth, since it is a cheap additional guarantee.
--
-- NOT SEPARATELY CHECKED, and why: badges and points are derived LIVE
-- by get_my_golf_summary() from scorecards/side_comps/
-- published_round_highlights at read time -- confirmed no separate
-- badges/points table exists anywhere in the schema -- so signals 2-4
-- and 7 already cover them transitively. Configured rounds, tees,
-- courses, and side_comps themselves are NEVER checked as blocking
-- signals -- they are pure setup, exactly the "configured but never
-- used" case the brief explicitly says must remain deletable.
--
-- Read-only: this function contains no INSERT/UPDATE/DELETE anywhere.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trip_has_protected_history(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_has_history BOOLEAN;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = p_trip_id AND role <> 'organiser')
    OR EXISTS (
      SELECT 1 FROM public.scorecards sc
      JOIN public.rounds r ON r.id = sc.round_id
      WHERE r.trip_id = p_trip_id
    )
    OR EXISTS (
      SELECT 1 FROM public.side_comp_entries sce
      JOIN public.side_comps scp ON scp.id = sce.side_comp_id
      WHERE scp.trip_id = p_trip_id
    )
    OR EXISTS (
      SELECT 1 FROM public.side_comp_lead_changes lc
      JOIN public.side_comps scp ON scp.id = lc.side_comp_id
      WHERE scp.trip_id = p_trip_id
    )
    OR EXISTS (SELECT 1 FROM public.moments WHERE trip_id = p_trip_id)
    OR EXISTS (SELECT 1 FROM public.event_messages WHERE trip_id = p_trip_id)
    OR EXISTS (SELECT 1 FROM public.published_round_highlights WHERE trip_id = p_trip_id)
  INTO v_has_history;

  RETURN v_has_history;
END;
$$;

NOTIFY pgrst, 'reload schema';
