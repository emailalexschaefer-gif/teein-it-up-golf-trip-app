-- =============================================================================
-- 066_published_round_highlights.sql
-- =============================================================================
-- Makers & Breakers Publish Lifecycle — persistence for organiser-
-- selected, published highlights.
--
-- Inspected first, per the explicit instruction: no existing highlight
-- persistence exists anywhere in this schema (confirmed by searching
-- every migration) — Makers & Breakers has been entirely deterministic-
-- recompute-on-demand up to this point, with no durable "this is the
-- official story" record at all. This is a genuine, new gap, not
-- something to extend.
--
-- One row PER ROUND, not one row per highlight. The full selected set
-- is stored as a single JSONB array — the Highlight shape (category,
-- kind, scope, icon, title, playerId, playerName, statLine, caption,
-- significance, groupId, groupName) is already fully defined and
-- stable in makersBreakers.ts; normalizing it into columns/a child
-- table would just be re-deriving a schema from a TypeScript interface
-- that already fully describes itself, for data that is never queried
-- by individual field — always read back as "the published set for
-- this round," matching the explicit "reuse existing highlight
-- persistence if available... if not, add the smallest additive
-- structure needed."
--
-- Republish replaces the row wholesale (UPSERT on round_id) rather
-- than inserting a new one — "do not create duplicate published
-- copies on every edit" is enforced by the UNIQUE constraint itself,
-- not by application-level cleanup logic.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.published_round_highlights (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE UNIQUE,
  trip_id      UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  -- The published Highlight[] — exactly the organiser-selected subset,
  -- never every qualifying candidate. Item 4's "candidate vs published"
  -- distinction lives entirely in whether a row exists here at all for
  -- a given round, and in this array containing only what was chosen.
  highlights   JSONB       NOT NULL,
  published_by UUID        NOT NULL REFERENCES public.profiles(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Item 15 — republish replaces in place; updated_at distinguishes a
  -- genuine edit from the original publish for audit purposes without
  -- keeping old copies around.
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS published_round_highlights_trip_id_idx ON public.published_round_highlights(trip_id);

ALTER TABLE public.published_round_highlights ENABLE ROW LEVEL SECURITY;

-- Read: any trip member — item 5/10, players read their own round's
-- published highlights via this same table, not a second copy.
DROP POLICY IF EXISTS "Published highlights: member read" ON public.published_round_highlights;
CREATE POLICY "Published highlights: member read" ON public.published_round_highlights FOR SELECT
  USING (public.is_trip_member(trip_id));

-- Write: organiser only — item 2/15, publishing and republishing are
-- both explicit organiser actions.
DROP POLICY IF EXISTS "Published highlights: organiser publish" ON public.published_round_highlights;
CREATE POLICY "Published highlights: organiser publish" ON public.published_round_highlights FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = published_round_highlights.trip_id AND profile_id = auth.uid() AND role = 'organiser')
  );

DROP POLICY IF EXISTS "Published highlights: organiser republish" ON public.published_round_highlights;
CREATE POLICY "Published highlights: organiser republish" ON public.published_round_highlights FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = published_round_highlights.trip_id AND profile_id = auth.uid() AND role = 'organiser')
  );

NOTIFY pgrst, 'reload schema';
