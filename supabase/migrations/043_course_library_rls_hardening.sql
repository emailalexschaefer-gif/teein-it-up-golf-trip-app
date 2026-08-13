-- =============================================================================
-- 043_course_library_rls_hardening.sql
-- =============================================================================
-- Fresh security audit finding (not a live incident — caught by review,
-- not by anything going wrong): course_tee_sets and course_tee_holes'
-- own "Members: read..." SELECT policies only checked their own
-- is_active flag, not the parent course's. Every actual read path this
-- app's own routes use already checks the course first (the organiser
-- search route filters courses.is_active before a tee set is ever
-- reachable at all; the tee-sets route explicitly 404s if the parent
-- course isn't active) — so this was never an exploitable gap through
-- this app's own UI/API. But RLS is supposed to be self-sufficient, not
-- dependent on every future caller remembering to check the parent
-- table first. If a course were ever deactivated while one of its tee
-- sets stayed active (an inconsistent admin state — nothing currently
-- enforces they move together), RLS alone would not have caught it.
-- Tightened here so RLS is correct standalone, matching "RLS
-- independently protects the shared tables" rather than relying on
-- every caller's own extra check.
-- =============================================================================

DROP POLICY IF EXISTS "Members: read published tee sets" ON public.course_tee_sets;
CREATE POLICY "Members: read published tee sets" ON public.course_tee_sets FOR SELECT
  USING (
    public.is_admin() OR (
      is_active = true
      AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_tee_sets.course_id AND c.is_active = true)
    )
  );

DROP POLICY IF EXISTS "Members: read tee hole data" ON public.course_tee_holes;
CREATE POLICY "Members: read tee hole data" ON public.course_tee_holes FOR SELECT
  USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.course_tee_sets cts
      JOIN public.courses c ON c.id = cts.course_id
      WHERE cts.id = course_tee_holes.tee_set_id AND cts.is_active = true AND c.is_active = true
    )
  );
