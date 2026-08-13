-- =============================================================================
-- 045_fix_delete_trip_cascade_lock.sql
-- =============================================================================
-- Bug fix: permanent trip deletion failed for any "populated" trip (one
-- with at least one round no longer 'upcoming' — i.e. any trip actually
-- worth testing deletion on).
--
-- Root cause: side_comps_lock_after_start (migration 037) fires on
-- BEFORE INSERT OR UPDATE OR DELETE. A cascade delete of trips ->
-- rounds -> side_comps still fires this trigger row-by-row. For a round
-- whose status isn't 'upcoming', the trigger raises an exception —
-- aborting the entire DELETE FROM trips transaction, not just the
-- side_comps row.
--
-- This trigger's actual purpose is to stop an organiser's config change
-- (adding/editing a Side Competition) from landing on a round that has
-- already started — the application's own PATCH /api/trips/[tripId]
-- route already gates this at the app level (never attempts to touch
-- side_comps for a non-upcoming round in the first place); the DB
-- trigger is defense-in-depth against a bypass of that check. It was
-- never meant to — and has no legitimate reason to — block a full
-- cascade teardown of a trip that's being permanently deleted.
--
-- Fix: narrow the trigger to INSERT OR UPDATE only. INSERT/UPDATE
-- protection against editing a live round's Side Competitions is fully
-- preserved — that's the actual scenario this lock exists for. DELETE
-- via cascade (the only way a side_comps row is ever deleted once a
-- round has started — nothing in the application ever issues a
-- standalone DELETE against a single side_comps row for an active
-- round, confirmed by inspecting every caller) is no longer blocked.
--
-- This is not a weakening of RLS (this is a plpgsql trigger, not a
-- policy) and not a change to any foreign key (every ON DELETE CASCADE
-- relationship from trips down through side_comps/side_comp_entries/
-- side_comp_lead_changes remains exactly as it was — that part was
-- already correct, verified by inspection before writing this).
-- =============================================================================

DROP TRIGGER IF EXISTS side_comps_lock_after_start ON public.side_comps;
CREATE TRIGGER side_comps_lock_after_start
  BEFORE INSERT OR UPDATE ON public.side_comps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_config_lock();
