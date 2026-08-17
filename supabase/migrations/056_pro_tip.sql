-- =============================================================================
-- 056_pro_tip.sql
-- =============================================================================
-- Pro Tip — Course Library + live scoring. Deliberately NOT added to
-- course_tee_holes (migration 039): that table is scoped to
-- tee_set_id, meaning the same strategic advice ("favour the left
-- centre of the fairway") would need to be entered once per tee colour
-- on every course, purely duplicated data — the green's shape and
-- hazards don't move based on which tees you're playing, only the
-- distance does. course_holes is course_id + hole_number scoped
-- instead — one Hole 7 tip per course, shared correctly across every
-- tee set that course has, matching "avoid unnecessary duplication
-- where the same strategy applies across tee colours."
--
-- Text only for V1, per explicit instruction — no audio column added
-- here; a nullable pro_tip_audio_url (or similar) can be added later
-- as its own small additive migration without touching this one.
--
-- Snapshot: library_holes_snapshot (rounds, migration 041) is already
-- a flexible JSONB array, not a fixed-column table — no migration is
-- needed to add pro_tip into each hole's snapshot entry, the
-- application code constructing that JSONB simply includes it going
-- forward. This preserves history correctly by construction: once a
-- round is created, its snapshot is a frozen copy, so a later Course
-- Library edit to the pro_tip can never silently change what an
-- already-configured round shows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.course_holes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  hole_number INTEGER     NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  pro_tip     TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, hole_number)
);

CREATE INDEX IF NOT EXISTS course_holes_course_id_idx ON public.course_holes(course_id);

ALTER TABLE public.course_holes ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can read the parent course (courses has no
-- read restriction beyond is_active in this app's existing model —
-- matching that same openness here, not inventing a narrower one).
CREATE POLICY "Anyone: view course holes" ON public.course_holes
  FOR SELECT USING (true);

-- Writes only via the admin client from Course Library's existing
-- admin-only API routes (src/lib/auth/requireAdmin.ts already gates
-- every write in that area) — no INSERT/UPDATE policy needed here,
-- RLS default-denies direct client writes, which is correct.
