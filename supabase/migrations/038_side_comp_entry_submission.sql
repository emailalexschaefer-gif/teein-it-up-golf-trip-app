-- =============================================================================
-- 038_side_comp_entry_submission.sql
-- =============================================================================
-- Sprint 9 Item 3 — the authoritative write path for Side Competition
-- results. Two RPC functions, matching begin_round()'s existing pattern
-- (migration 016) for "a multi-step operation that must be atomic gets a
-- Postgres function, not several round-tripped admin-client calls with a
-- race window between them":
--
-- - submit_side_comp_value_entry() — Nearest the Pin and Pro's Approach,
--   which share identical behaviour (smallest qualifying distance wins),
--   per the explicit "don't build unrelated implementations" instruction.
-- - submit_longest_drive_entry() — genuinely different: V1 has no
--   measured distance, so leadership is the player's own "did you beat
--   the current leader?" assertion, not a value comparison. Kept as a
--   separate function rather than forcing false uniformity onto two
--   different kinds of leadership decision.
--
-- Both functions:
--   * lock the side_comps row (SELECT ... FOR UPDATE) for the duration of
--     the leadership decision, so two golfers finishing the same hole
--     seconds apart can never race each other into an inconsistent
--     "leader" state — this is the concrete mechanism behind "the server
--     decides leadership, not the client".
--   * upsert side_comp_entries (the current, correctable result) —
--     UNIQUE(side_comp_id, player_id) already makes a resubmission an
--     UPDATE, not a duplicate row.
--   * only INSERT into side_comp_lead_changes (append-only) on a genuine
--     leadership change — a resubmission of the same value, or a
--     submission that doesn't beat the leader, writes zero history rows.
--   * return exactly the fields the client needs to render the result
--     without itself deciding anything: becameLeader, currentLeaderName,
--     currentLeaderResult, entryId, leadChangeId (null if no change).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_side_comp_value_entry(
  p_side_comp_id UUID,
  p_player_id    UUID,
  p_qualified    BOOLEAN,
  p_result_value NUMERIC,
  p_entered_by   UUID
) RETURNS TABLE (
  entry_id UUID, became_leader BOOLEAN,
  current_leader_player_id UUID, current_leader_name TEXT, current_leader_value NUMERIC,
  lead_change_id UUID
) LANGUAGE plpgsql AS $$
DECLARE
  v_round_id       UUID;
  v_round_status   TEXT;
  v_entry_id       UUID;
  v_old_leader_id  UUID;
  v_new_leader_id  UUID;
  v_became_leader  BOOLEAN := false;
  v_lead_change_id UUID;
  v_next_seq       INTEGER;
  v_leader_row     RECORD;
BEGIN
  -- Lock this competition for the duration of the decision — the actual
  -- mechanism preventing two near-simultaneous submissions from both
  -- (wrongly) believing they're the new leader.
  SELECT round_id INTO v_round_id FROM public.side_comps WHERE id = p_side_comp_id FOR UPDATE;
  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'Side competition not found.';
  END IF;

  SELECT status INTO v_round_status FROM public.rounds WHERE id = v_round_id;
  IF v_round_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This round is not currently active.';
  END IF;

  IF NOT p_qualified THEN
    p_result_value := NULL;
  ELSIF p_result_value IS NULL OR p_result_value <= 0 THEN
    RAISE EXCEPTION 'A qualifying result requires a positive distance.';
  END IF;

  -- Who was leading BEFORE this submission, across every player
  -- (including this one's own prior value, if any) — the baseline this
  -- submission is compared against.
  SELECT player_id INTO v_old_leader_id
    FROM public.side_comp_entries
    WHERE side_comp_id = p_side_comp_id AND qualified = true
    ORDER BY result_value ASC LIMIT 1;

  INSERT INTO public.side_comp_entries (side_comp_id, player_id, qualified, result_value, entered_by)
  VALUES (p_side_comp_id, p_player_id, p_qualified, p_result_value, p_entered_by)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE
    SET qualified = EXCLUDED.qualified, result_value = EXCLUDED.result_value, updated_at = now()
  RETURNING id INTO v_entry_id;

  -- Who is leading AFTER this submission — same query, re-run now that
  -- this player's entry has actually been written.
  SELECT player_id INTO v_new_leader_id
    FROM public.side_comp_entries
    WHERE side_comp_id = p_side_comp_id AND qualified = true
    ORDER BY result_value ASC LIMIT 1;

  -- A genuine leadership CHANGE means the identity of who's leading is
  -- different afterwards, and it's now this submitting player. This is
  -- deliberately NOT "is my value the best right now" (that comparison,
  -- checked only against OTHER players, was the actual bug found during
  -- review before this shipped: an already-leading player resubmitting
  -- their own unchanged value — a habitual re-tap, or a correction that
  -- doesn't actually move their number — would otherwise still pass that
  -- check every time and log a spurious duplicate "leadership change",
  -- violating the explicit idempotency requirement that a repeated,
  -- functionally identical submission must be a safe no-op). Comparing
  -- leader identity before vs. after fixes this: if the same player was
  -- already leading and is still leading, nothing changed hands, so
  -- nothing is logged — matching the brief's own framing of counting
  -- hand-offs between different players, not every value tweak by
  -- whoever's already ahead.
  v_became_leader := (v_new_leader_id = p_player_id) AND (v_new_leader_id IS DISTINCT FROM v_old_leader_id);

  IF v_became_leader THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_next_seq
      FROM public.side_comp_lead_changes WHERE side_comp_id = p_side_comp_id;
    INSERT INTO public.side_comp_lead_changes (side_comp_id, player_id, result_value, sequence_number)
    VALUES (p_side_comp_id, p_player_id, p_result_value, v_next_seq)
    RETURNING id INTO v_lead_change_id;
  END IF;

  -- Current leader after this submission — always the best CURRENT
  -- qualifying entry (a live query, not a stored scalar), so a later
  -- correction to any player's entry is reflected accurately without
  -- ever needing to rewrite this function or the lead-change log.
  SELECT sce.player_id, p.full_name, sce.result_value
    INTO v_leader_row
    FROM public.side_comp_entries sce JOIN public.profiles p ON p.id = sce.player_id
    WHERE sce.side_comp_id = p_side_comp_id AND sce.qualified = true
    ORDER BY sce.result_value ASC LIMIT 1;

  RETURN QUERY SELECT v_entry_id, v_became_leader,
    v_leader_row.player_id, v_leader_row.full_name, v_leader_row.result_value,
    v_lead_change_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_longest_drive_entry(
  p_side_comp_id     UUID,
  p_player_id        UUID,
  p_qualified        BOOLEAN,
  p_claims_beat_lead  BOOLEAN, -- self-reported (no GPS distance in V1) — only meaningful when a leader already exists
  p_entered_by       UUID
) RETURNS TABLE (
  entry_id UUID, became_leader BOOLEAN,
  current_leader_player_id UUID, current_leader_name TEXT,
  lead_change_id UUID
) LANGUAGE plpgsql AS $$
DECLARE
  v_round_id       UUID;
  v_round_status   TEXT;
  v_entry_id       UUID;
  v_became_leader  BOOLEAN := false;
  v_lead_change_id UUID;
  v_next_seq       INTEGER;
  v_prior_leader   RECORD; -- standing leader BEFORE this submission — used only to decide v_became_leader
  v_leader_row     RECORD; -- standing leader AFTER this submission — always re-derived fresh, what's actually returned
BEGIN
  SELECT round_id INTO v_round_id FROM public.side_comps WHERE id = p_side_comp_id FOR UPDATE;
  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'Side competition not found.';
  END IF;

  SELECT status INTO v_round_status FROM public.rounds WHERE id = v_round_id;
  IF v_round_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This round is not currently active.';
  END IF;

  INSERT INTO public.side_comp_entries (side_comp_id, player_id, qualified, result_value, entered_by)
  VALUES (p_side_comp_id, p_player_id, p_qualified, NULL, p_entered_by)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE
    SET qualified = EXCLUDED.qualified, result_value = NULL, updated_at = now()
  RETURNING id INTO v_entry_id;

  -- Standing leader BEFORE this submission's effect is decided — derived
  -- by walking the append-only lead-change log from most recent
  -- backwards until finding one whose player's CURRENT entry is still
  -- qualified. This runs after the upsert above but is only used to
  -- decide whether THIS player beats whoever stood immediately prior;
  -- it is deliberately NOT reused for the response (see v_leader_row
  -- below) — reusing it would return a stale answer for the exact case
  -- this whole split exists to handle: a player disqualifying themselves
  -- out of the lead via a correction.
  SELECT lc.player_id, p.full_name INTO v_prior_leader
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comp_entries sce ON sce.side_comp_id = lc.side_comp_id AND sce.player_id = lc.player_id
    JOIN public.profiles p ON p.id = lc.player_id
    WHERE lc.side_comp_id = p_side_comp_id AND sce.qualified = true
    ORDER BY lc.sequence_number DESC LIMIT 1;

  IF p_qualified THEN
    -- No standing leader yet (either genuinely the first qualifying
    -- entrant, or every prior leader has since been corrected out) — a
    -- qualifying drive becomes leader automatically, per the brief's own
    -- "if there is no leader ... allow them to become leader" rule.
    -- Otherwise, leadership only changes if THIS player explicitly
    -- claims to have beaten the standing leader — never inferred.
    IF v_prior_leader.player_id IS NULL THEN
      v_became_leader := true;
    ELSIF v_prior_leader.player_id <> p_player_id AND p_claims_beat_lead IS TRUE THEN
      v_became_leader := true;
    END IF;
  END IF;

  IF v_became_leader THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_next_seq
      FROM public.side_comp_lead_changes WHERE side_comp_id = p_side_comp_id;
    INSERT INTO public.side_comp_lead_changes (side_comp_id, player_id, result_value, sequence_number)
    VALUES (p_side_comp_id, p_player_id, 0, v_next_seq) -- result_value has no meaning for Longest Drive in V1; 0 is a placeholder, never displayed (the client never reads this column for this comp_type)
    RETURNING id INTO v_lead_change_id;
  END IF;

  -- Standing leader AFTER every write above — re-derived fresh (same
  -- walk-the-log-verify-current-qualified logic), never assumed from
  -- v_prior_leader or from v_became_leader. This is what makes a
  -- self-disqualifying correction report accurately: if the player who
  -- just set qualified=false was the prior leader, this query naturally
  -- skips their now-disqualified entry and finds whoever qualified
  -- earliest among the remaining valid history — or NULL if nobody
  -- still qualifies, which the API/UI must render as "no leader
  -- currently stands", not silently keep showing the old name.
  SELECT lc.player_id, p.full_name INTO v_leader_row
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comp_entries sce ON sce.side_comp_id = lc.side_comp_id AND sce.player_id = lc.player_id
    JOIN public.profiles p ON p.id = lc.player_id
    WHERE lc.side_comp_id = p_side_comp_id AND sce.qualified = true
    ORDER BY lc.sequence_number DESC LIMIT 1;

  RETURN QUERY SELECT v_entry_id, v_became_leader,
    v_leader_row.player_id, v_leader_row.full_name,
    v_lead_change_id;
END;
$$;
