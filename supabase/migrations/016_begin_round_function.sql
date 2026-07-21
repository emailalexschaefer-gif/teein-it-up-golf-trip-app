-- =============================================================================
-- 016: begin_round() — atomic transaction function for Sprint 5A
-- =============================================================================
-- Called via supabase.rpc('begin_round', { ... }) from the start-round API.
-- Wraps all three operations in a single database transaction:
--   1. Upsert hole records
--   2. Upsert scorecard records
--   3. Transition round status: upcoming → active
--
-- If any step fails, the entire transaction rolls back. The round is never
-- left in a partially-started state.
--
-- Security: SECURITY DEFINER runs as the function owner (postgres/service role).
-- The API layer verifies organiser permissions before calling this function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index}
  p_scorecard_data   JSONB     -- array of {player_id, playing_handicap}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holes_count      INTEGER := 0;
  v_scorecards_count INTEGER := 0;
  v_hole             JSONB;
  v_card             JSONB;
BEGIN
  -- Verify round is still upcoming (guard against race conditions)
  IF NOT EXISTS (
    SELECT 1 FROM public.rounds WHERE id = p_round_id AND status = 'upcoming'
  ) THEN
    RAISE EXCEPTION 'ROUND_NOT_UPCOMING: This round cannot be started (it may have already begun).';
  END IF;

  -- ── 1. Upsert holes ────────────────────────────────────────────────────────
  FOR v_hole IN SELECT * FROM jsonb_array_elements(p_hole_data)
  LOOP
    INSERT INTO public.holes (round_id, hole_number, par, stroke_index)
    VALUES (
      p_round_id,
      (v_hole->>'hole_number')::INTEGER,
      (v_hole->>'par')::INTEGER,
      (v_hole->>'stroke_index')::INTEGER
    )
    ON CONFLICT (round_id, hole_number)
    DO UPDATE SET
      par          = EXCLUDED.par,
      stroke_index = EXCLUDED.stroke_index;

    v_holes_count := v_holes_count + 1;
  END LOOP;

  -- ── 2. Upsert scorecards ───────────────────────────────────────────────────
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_scorecard_data)
  LOOP
    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, status)
    VALUES (
      p_round_id,
      (v_card->>'player_id')::UUID,
      (v_card->>'playing_handicap')::INTEGER,
      'active'
    )
    ON CONFLICT (round_id, player_id)
    DO UPDATE SET
      playing_handicap = EXCLUDED.playing_handicap,
      status           = 'active';

    v_scorecards_count := v_scorecards_count + 1;
  END LOOP;

  -- ── 3. Transition round status ─────────────────────────────────────────────
  UPDATE public.rounds
    SET status = 'active'
    WHERE id = p_round_id;

  -- ── Return summary ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'round_id',          p_round_id,
    'status',            'active',
    'holes_created',     v_holes_count,
    'scorecards_created', v_scorecards_count
  );

EXCEPTION
  WHEN OTHERS THEN
    -- The surrounding transaction automatically rolls back.
    -- Re-raise so the caller receives the error message.
    RAISE;
END;
$$;

-- Grant execute to the service role (used by the admin client in the API)
GRANT EXECUTE ON FUNCTION public.begin_round(UUID, JSONB, JSONB)
  TO service_role;

-- Verification:
-- SELECT proname FROM pg_proc WHERE proname = 'begin_round';
-- Should return: begin_round
