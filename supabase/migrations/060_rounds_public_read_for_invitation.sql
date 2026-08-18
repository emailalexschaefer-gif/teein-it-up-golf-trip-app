-- =============================================================================
-- 060_rounds_public_read_for_invitation.sql
-- =============================================================================
-- Priority 1B fix: the invitation panel's round count was silently
-- missing. Root cause: rounds' only SELECT policy
-- ("Members: view", USING (is_trip_member(trip_id))) requires the
-- querying user to already be a trip member — by definition impossible
-- for someone viewing an invitation they haven't joined yet. The
-- round-count query was failing via RLS on every single invitation
-- page visit, caught by its own try/catch (deliberately non-fatal to
-- the rest of the invitation panel), silently resulting in
-- roundCount = null every time.
--
-- Fix matches the exact established precedent already in this schema
-- for the identical problem on trips itself (002_trips.sql, "Anyone:
-- read by invite code", USING (true)) — trips.name/status/dates/logo_url
-- are already openly readable for this same reason. rounds.name/
-- play_date/course_name/holes/scoring_format/status are comparable
-- event-logistics information, not materially more sensitive than what
-- trips already exposes under the same open-read precedent.
--
-- Additive only — the existing "Members: view" policy is untouched;
-- RLS policies are OR'd together, so this only ever adds visibility,
-- never removes any existing member's access.
-- =============================================================================

DROP POLICY IF EXISTS "Anyone: read for invitation preview" ON public.rounds;
CREATE POLICY "Anyone: read for invitation preview"
  ON public.rounds FOR SELECT
  USING (true);
