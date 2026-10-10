-- =============================================================================
-- 095_moments_unassigned_and_aftershow.sql
-- =============================================================================
-- V1.18 (10 Oct) -- Slideshow Final Release: Closing Screen, Upload
-- Moments & Moments and Bloopers Aftershow.
--
-- AUDITED FIRST, per the explicit Package 7 instruction ("do not
-- introduce a database migration unless the existing schema genuinely
-- cannot support the requirements... explain why before implementing"):
-- every moments migration from 028 through 091 was read in full before
-- writing this one. Two genuine schema gaps were found, neither of
-- which the existing schema can already represent:
--
-- GAP 1 -- "Upload Moments" (Package 2) needs to store an organiser-
-- uploaded, event-level photo/video with NO player association at all
-- (e.g. a WhatsApp photo with no reliable way to know whose it is),
-- per the brief's own explicit "do not invent a player association"
-- rule. moments.player_id has been `NOT NULL REFERENCES profiles(id)`
-- since the table's creation (028) and was never relaxed by any later
-- migration (063/085/086/087/088/089/090/091 all audited directly --
-- none of them touch this column's nullability). The table structurally
-- cannot represent "this photo belongs to no one in particular" today.
-- Separately, the INSERT RLS policy (028, replaced by 065's proxy-
-- capture version) requires EITHER player_id = auth.uid() OR a proxy-
-- capture relationship between captured_by and player_id -- there is
-- no clause at all for "the organiser is uploading something with no
-- subject." Both the column and the policy need to change for this
-- genuinely new case to be possible; this is not a judgement call.
--
-- GAP 2 -- "Include in Aftershow" (Package 3/4) needs an organiser
-- decision that (a) is independent of is_event_favourite/is_blooper,
-- (b) must survive a slideshow-builder refresh (the brief's own most
-- heavily flagged requirement: "do not silently reselect previously
-- excluded Moments when the slideshow builder refreshes"), and
-- therefore (c) cannot live only in React state for the current
-- viewing session the way the ORDINARY slideshow curation already
-- does (documented in slideshowDeck.ts's own Phase 1 audit notes --
-- that was an explicit, deliberate choice for the main deck, but it
-- cannot satisfy THIS brief's explicit persistence requirement).
-- Nothing in the existing schema already stores a tri-state organiser
-- override per Moment for a presentation-only selection. The exact
-- same pattern already exists twice for this purpose -- a persisted
-- BOOLEAN column on moments, scoped to one organiser decision
-- (is_event_favourite, 085; is_blooper, 086) -- so this follows that
-- established pattern rather than inventing a new one, and is a tri-
-- state (NULL/true/false) rather than a plain boolean specifically
-- because "not yet decided, follow the automatic suggestion" is a
-- real, distinct third state this feature needs (NULL), not
-- representable by a two-value boolean defaulting to one side.
--
-- This is explicitly NOT a new "Moment classification" alongside
-- Favourite/Blooper (the brief's own "do not introduce a mandatory
-- generic Moment tag" instruction) -- it only ever affects which
-- Moments populate ONE section of ONE kind of output (the Moments &
-- Bloopers aftershow chapter of an Event Highlights presentation). It
-- is stored on the Moment record (matching the existing organiser-
-- override pattern) purely because that is the only place an organiser
-- decision about a specific Moment can be persisted and later resolved
-- consistently by both the picker UI and the deck builder, exactly as
-- is_event_favourite and is_blooper already are.
--
-- SAFETY: additive and non-destructive throughout.
--   - DROP NOT NULL on player_id changes no existing row -- every
--     existing Moment already has a real player_id (028's own
--     original schema), so this only WIDENS what's possible for a
--     future row; nothing currently stored is affected.
--   - The new CHECK constraint (every row identifies SOMEONE, either
--     the subject or the uploader) is satisfied by every existing row
--     trivially, since player_id is non-null for all of them today.
--   - The RLS policy replacement adds one new clause; the two existing
--     clauses (plain self-capture, proxy capture) are reproduced
--     verbatim, so no existing upload path's behaviour changes.
--   - aftershow_included is ADD COLUMN IF NOT EXISTS, NULL, no default
--     needed beyond NULL itself (Postgres's own implicit column
--     default) -- every existing Moment starts in the "not yet
--     decided, follow the automatic suggestion" state, which is
--     exactly the correct, non-disruptive interpretation for a Moment
--     that existed before this feature did.
-- =============================================================================

-- ---- Gap 1: nullable player_id ----

ALTER TABLE public.moments ALTER COLUMN player_id DROP NOT NULL;

-- Every Moment must still identify SOMEONE -- either the achievement
-- subject (player_id) or, when there is deliberately no subject, the
-- person who actually uploaded it (captured_by). This is what
-- prevents a genuinely anonymous, untraceable row from ever being
-- written, while still allowing "no player association" exactly as
-- the brief requires.
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_player_or_captured_by_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_player_or_captured_by_check
  CHECK (player_id IS NOT NULL OR captured_by IS NOT NULL);

-- RLS: add the organiser-unassigned-upload case to the existing
-- proxy-capture policy (065), reproducing both of its existing clauses
-- verbatim. The new clause: an event-level Moment with no player
-- association can only be written when (a) player_id is genuinely
-- NULL -- never an arbitrary id the client happened to send, (b) the
-- uploader identifies themselves as captured_by (never anonymous),
-- and (c) the uploader is this trip's own organiser (trips.organiser_id)
-- -- the same authority the sibling favourite/blooper PATCH routes
-- already require for an organiser-only decision, applied here at the
-- database layer too, not just in the API route's own check (the API
-- route's check is for a clear error message; this is the actual
-- safety guarantee, matching the stated reasoning for every other
-- organiser-gated CHECK/RLS pair in this schema's history).
DROP POLICY IF EXISTS "Moments: member create own or proxy capture" ON public.moments;

CREATE POLICY "Moments: member create own, proxy capture, or organiser unassigned upload" ON public.moments FOR INSERT
  WITH CHECK (
    (
      player_id = auth.uid()
      OR (
        captured_by = auth.uid()
        AND player_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.trip_members tm_subject
          JOIN public.trip_members tm_capturer
            ON tm_capturer.trip_id = tm_subject.trip_id
            AND tm_capturer.group_id = tm_subject.group_id
          WHERE tm_subject.trip_id = moments.trip_id
            AND tm_subject.profile_id = moments.player_id
            AND tm_capturer.profile_id = auth.uid()
            AND tm_subject.group_id IS NOT NULL
        )
      )
      OR (
        player_id IS NULL
        AND captured_by = auth.uid()
        AND EXISTS (SELECT 1 FROM public.trips WHERE id = moments.trip_id AND organiser_id = auth.uid())
      )
    )
    AND public.is_trip_member(trip_id)
    AND (
      group_id IS NULL
      OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid() AND group_id = moments.group_id)
    )
  );

-- Read policy (028) already covers this correctly with zero changes:
-- an unassigned Moment is always audience = 'everyone' (enforced in
-- the API route, see moments/route.ts), so every trip member already
-- reads it via the existing "audience = 'everyone'" branch -- the
-- read policy's OTHER branches (group membership, player_id = auth.uid())
-- simply never apply to it, which is correct and requires no change.

-- ---- Gap 2: the aftershow selection override ----

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS aftershow_included BOOLEAN;

CREATE INDEX IF NOT EXISTS moments_trip_aftershow_idx
  ON public.moments(trip_id) WHERE aftershow_included IS NOT NULL;

COMMENT ON COLUMN public.moments.player_id IS
  'The achievement/story subject. NULL for an organiser-uploaded, event-level Moment with no identifiable subject (migration 095) -- never guessed or defaulted to the uploader; see captured_by for who actually uploaded it in that case.';
COMMENT ON COLUMN public.moments.aftershow_included IS
  'Organiser override for this Moment''s inclusion in the Event Highlights "Moments & Bloopers" aftershow chapter -- a presentation-only selection, NOT a Moment classification (Favourite/Blooper are untouched by this). NULL (the default for every Moment) means "not yet decided -- follow the automatic suggestion" (is_blooper, or an unassigned event-level upload); true/false is an explicit organiser decision that always wins over the suggestion and is never silently reset, including when new Moments are later uploaded. See resolveAftershowMomentIds in slideshowDeck.ts for the single place this resolution logic lives.';

NOTIFY pgrst, 'reload schema';
