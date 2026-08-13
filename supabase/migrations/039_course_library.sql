-- =============================================================================
-- 039_course_library.sql
-- =============================================================================
-- Course Library v1 — a shared, admin-managed library of courses/tee
-- sets/hole data that organisers can search and load into a round, with
-- manual course setup kept as a permanent, equal fallback.
--
-- Investigated before writing this (see delivery notes for the full
-- report): no course library, no app-level role, and no slope_rating
-- column exist anywhere in the current schema. `holes` has no distance
-- column. `calculateDailyHandicap()` (src/lib/scoring/dailyHandicap.ts)
-- already implements GA Handicap × Slope Rating ÷ 113, fully tested, but
-- has been dormant since it was written because nothing has ever stored
-- a slope_rating for it to read. Nothing here is destructive — every
-- change is a new table or a new nullable column.
--
-- Conceptual model, exactly as specified:
--   courses -> course_tee_sets -> course_tee_holes
-- Deliberately NOT further normalised (e.g. a separate "course-level
-- holes" table shared across tee sets with per-tee distance overrides) —
-- stroke index and par can occasionally differ by tee in practice, and
-- collapsing them into one shared table purely to avoid a little
-- duplication would make the admin editing screens (Item 17: edit one
-- hole on one tee set) harder to reason about for no real benefit at
-- this scale. Matches the brief's own given model directly.
-- =============================================================================

-- ─── 1. app_role — the new role capability ──────────────────────────────────
-- Default 'member' for everyone, including existing rows. No identities
-- hard-coded anywhere in this migration — see the delivery notes for the
-- exact, separate SQL to run once, by hand, in the Supabase SQL editor,
-- to promote Alex's and Darren's specific existing accounts. This
-- migration only builds the capability.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_role TEXT NOT NULL DEFAULT 'member'
  CHECK (app_role IN ('member', 'admin'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND app_role = 'admin'
  );
END;
$$;

-- ─── 2. courses ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.courses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_name   TEXT        NOT NULL,
  course_name TEXT        NOT NULL, -- e.g. "Champions Course" — Sandhurst Champions and Sandhurst North
                                     -- are deliberately two separate rows, not one course with a variant field
  suburb      TEXT,
  state       TEXT,
  country     TEXT        NOT NULL DEFAULT 'Australia',
  is_active   BOOLEAN     NOT NULL DEFAULT true, -- unpublished/draft courses are excluded from organiser search
  source      TEXT,        -- provenance description, e.g. "Golf Australia course rating tables, verified Aug 2026"
  source_url  TEXT,
  verified_at DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS courses_active_idx ON public.courses(is_active);

DROP TRIGGER IF EXISTS courses_updated_at ON public.courses;
CREATE TRIGGER courses_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── 3. course_tee_sets ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.course_tee_sets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      UUID        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL, -- "White", "Championship", etc — not constrained to a fixed colour list,
                                        -- per the explicit "do not assume every course uses the same colours"
  colour         TEXT,        -- display colour (hex or named) for the tee-selection UI
  gender         TEXT,        -- nullable free text (e.g. "Men's", "Women's", "Mixed") — only some courses rate this separately
  par            INTEGER     CHECK (par IS NULL OR par BETWEEN 60 AND 80),
  total_distance INTEGER,     -- metres
  course_rating  NUMERIC(4,1), -- Scratch/Course Rating — belongs to the tee set, not a separate "daily" field
  slope_rating   INTEGER     CHECK (slope_rating IS NULL OR slope_rating BETWEEN 55 AND 155), -- WHS slope range;
                                                                                                 -- deliberately NOT named "daily_slope"
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID        REFERENCES public.profiles(id),
  UNIQUE (course_id, name)
);

CREATE INDEX IF NOT EXISTS course_tee_sets_course_id_idx ON public.course_tee_sets(course_id);

DROP TRIGGER IF EXISTS course_tee_sets_updated_at ON public.course_tee_sets;
CREATE TRIGGER course_tee_sets_updated_at
  BEFORE UPDATE ON public.course_tee_sets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── 4. course_tee_holes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.course_tee_holes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tee_set_id   UUID        NOT NULL REFERENCES public.course_tee_sets(id) ON DELETE CASCADE,
  hole_number  INTEGER     NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par          INTEGER     NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index INTEGER     CHECK (stroke_index IS NULL OR stroke_index BETWEEN 1 AND 18),
  distance     INTEGER,     -- metres, nullable — "leave nullable where appropriate" per the explicit instruction
  UNIQUE (tee_set_id, hole_number)
);

CREATE INDEX IF NOT EXISTS course_tee_holes_tee_set_id_idx ON public.course_tee_holes(tee_set_id);

-- ─── 5. Round snapshot columns ───────────────────────────────────────────────
-- Purely additive, all nullable — an existing round with none of these
-- set behaves exactly as it always has (manual setup, no library link).
-- tee_set_source_id is a PROVENANCE breadcrumb only ("this round was
-- originally loaded from this tee set") — nothing anywhere may ever
-- re-join through it to re-fetch live library data for display or
-- scoring. Every actual value a round needs (course name, rating,
-- slope, and each hole's par/stroke_index/distance) is copied directly
-- onto rounds/holes at load time, which is what makes a later Course
-- Library edit incapable of retroactively changing an already-created
-- round, by construction — there is no live read path back to the
-- source tables at all, only this one nullable audit reference.

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS tee_set_source_id UUID REFERENCES public.course_tee_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tee_name          TEXT,
  ADD COLUMN IF NOT EXISTS course_rating     NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS slope_rating      INTEGER;

ALTER TABLE public.holes
  ADD COLUMN IF NOT EXISTS distance INTEGER;

-- ─── 6. RLS ──────────────────────────────────────────────────────────────────
-- Read: any authenticated user may read PUBLISHED (is_active) library
-- data — this is a shared, global library, not scoped to any one trip,
-- so is_trip_member() doesn't apply here; membership in the app itself
-- (being a logged-in profile) is the read boundary. Write: is_admin()
-- only, enforced at the database layer per the explicit "not just
-- visually" instruction — client-side hiding of admin controls is a UX
-- nicety here, never the actual security boundary.

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members: read published courses" ON public.courses;
CREATE POLICY "Members: read published courses" ON public.courses FOR SELECT
  USING (is_active = true OR public.is_admin());
DROP POLICY IF EXISTS "Admins: manage courses" ON public.courses;
CREATE POLICY "Admins: manage courses" ON public.courses FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.course_tee_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members: read published tee sets" ON public.course_tee_sets;
CREATE POLICY "Members: read published tee sets" ON public.course_tee_sets FOR SELECT
  USING (is_active = true OR public.is_admin());
DROP POLICY IF EXISTS "Admins: manage tee sets" ON public.course_tee_sets;
CREATE POLICY "Admins: manage tee sets" ON public.course_tee_sets FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.course_tee_holes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members: read tee hole data" ON public.course_tee_holes;
CREATE POLICY "Members: read tee hole data" ON public.course_tee_holes FOR SELECT
  USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.course_tee_sets cts WHERE cts.id = course_tee_holes.tee_set_id AND cts.is_active = true
    )
  );
DROP POLICY IF EXISTS "Admins: manage tee hole data" ON public.course_tee_holes;
CREATE POLICY "Admins: manage tee hole data" ON public.course_tee_holes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
