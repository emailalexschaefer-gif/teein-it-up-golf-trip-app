-- =============================================================================
-- 071_fix_side_comp_verifier_group_scoping.sql
-- =============================================================================
-- Consolidated Test + Fix brief (1 Sep) — item 1, "Side Game multi-group
-- verification stranding."
--
-- ROOT CAUSE, found by reading resolve_side_comp_verifier()'s actual,
-- unchanged-since-047 body directly (confirmed via grep that no later
-- migration ever redeclared it):
--
-- Its final fallback tier — reached whenever a claimant has no
-- round_markers row AND the organiser IS the claimant or doesn't
-- exist — was:
--
--   SELECT sc.player_id FROM public.scorecards sc
--   WHERE sc.round_id = p_round_id AND sc.player_id <> p_player_id ...
--   ORDER BY sc.player_id LIMIT 1;
--
-- This is scoped to the ENTIRE ROUND, not the claimant's own playing
-- group — for a multi-group round, this can resolve to a player in a
-- completely different group, ordered arbitrarily by UUID. A Paper
-- player never has a round_markers row at all (shared-device pairing
-- deliberately never writes one — established elsewhere in this
-- codebase's own architecture), so this exact fallback path is
-- precisely the one a Paper player's claim hits whenever the
-- organiser is themselves the claimant (a Digital player entering a
-- result FOR their Paper partner, where that Digital player also
-- happens to be the organiser — exactly Darren's own test setup) or
-- doesn't exist. The claim's required_verifier_id ends up pointing at
-- some other, unrelated player in a different group, who has no
-- reason to ever open or resolve it — a permanently stranded "Awaiting
-- Playing Partner verification" claim, matching the reported symptom
-- exactly. This also fully explains why the single-group test worked:
-- with only one group in the whole round, "any other scorecard in the
-- round" and "any other scorecard in my group" are the same set.
--
-- FIX — two changes, both narrow, neither touching the confirmed-
-- working Digital<->Digital round_markers path (still checked first,
-- completely unchanged) or the underlying verification MODEL (claim ->
-- pending -> verify -> official) at all:
--
--   1. NEW second-priority check: shared-device pairing. If the
--      claimant has no round_markers row (true for every Paper player,
--      and possible for a Digital player with no marker set yet), and
--      their playing group is exactly 1 Digital + 1 Paper, the OTHER
--      member of that pair is the verifier — this is what actually
--      makes both of the brief's "confirmed working" flows resolve to
--      the RIGHT person (each other) rather than accidentally working
--      by coincidence in a single-group test. Reuses the same "exactly
--      1 digital + 1 paper in a 2-player group" rule already
--      established in detectSharedDeviceGroup (TypeScript) — expressed
--      here in SQL since this resolution genuinely has to happen
--      server-side, in the same transaction as the claim itself.
--   2. The final "any other scorecard" fallback is now scoped to the
--      claimant's own playing group (via trip_members.group_id), not
--      the whole round — matching what item 1's own brief explicitly
--      asked to check ("whether verifier lookup is correctly scoped by
--      round_id + group_id"). The organiser-fallback tier in between is
--      deliberately left round/trip-wide, unchanged — an organiser is
--      a legitimate authority for any claim regardless of group, and
--      narrowing that specifically was never the reported problem.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_side_comp_verifier(
  p_round_id UUID, p_trip_id UUID, p_player_id UUID
) RETURNS TABLE (verifier_id UUID, verifier_source TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_marker_id       UUID;
  v_organiser_id    UUID;
  v_claimant_group  UUID;
  v_shared_device_partner UUID;
  v_other_player    UUID;
BEGIN
  SELECT marker_player_id INTO v_marker_id
    FROM public.round_markers WHERE round_id = p_round_id AND player_id = p_player_id;

  IF v_marker_id IS NOT NULL THEN
    RETURN QUERY SELECT v_marker_id, 'marker'::TEXT;
    RETURN;
  END IF;

  -- Shared-device pairing — checked before the organiser/cross-group
  -- fallbacks, exactly matching how live scoring itself already
  -- prioritises shared-device detection over a round_markers lookup
  -- (see resolveMarkedPlayerId, sharedDeviceScoring.ts). A Paper
  -- player never has a round_markers row at all, so without this
  -- check they always fell straight through to the fallbacks below.
  SELECT tm.group_id INTO v_claimant_group
    FROM public.trip_members tm WHERE tm.trip_id = p_trip_id AND tm.profile_id = p_player_id;

  IF v_claimant_group IS NOT NULL THEN
    SELECT sc.player_id INTO v_shared_device_partner
      FROM public.scorecards sc
      JOIN public.trip_members tm ON tm.trip_id = p_trip_id AND tm.profile_id = sc.player_id
      WHERE sc.round_id = p_round_id AND tm.group_id = v_claimant_group AND sc.status <> 'withdrawn'
        AND sc.player_id <> p_player_id
      -- Exactly 1 digital + 1 paper in this group is the same rule
      -- detectSharedDeviceGroup enforces — this only matches when the
      -- claimant's own scoring_method genuinely differs from the
      -- candidate's, in a group of exactly two.
      AND sc.scoring_method <> (SELECT scoring_method FROM public.scorecards WHERE round_id = p_round_id AND player_id = p_player_id)
      AND (SELECT COUNT(*) FROM public.scorecards sc2
             JOIN public.trip_members tm2 ON tm2.trip_id = p_trip_id AND tm2.profile_id = sc2.player_id
             WHERE sc2.round_id = p_round_id AND tm2.group_id = v_claimant_group AND sc2.status <> 'withdrawn') = 2;

    IF v_shared_device_partner IS NOT NULL THEN
      RETURN QUERY SELECT v_shared_device_partner, 'shared_device_partner'::TEXT;
      RETURN;
    END IF;
  END IF;

  SELECT profile_id INTO v_organiser_id
    FROM public.trip_members WHERE trip_id = p_trip_id AND role = 'organiser' LIMIT 1;

  IF v_organiser_id IS NOT NULL AND v_organiser_id <> p_player_id THEN
    RETURN QUERY SELECT v_organiser_id, 'organiser_fallback'::TEXT;
    RETURN;
  END IF;

  -- Scoped to the claimant's own playing group — was scoped to the
  -- entire round, which is the actual bug this migration fixes.
  SELECT sc.player_id INTO v_other_player
    FROM public.scorecards sc
    JOIN public.trip_members tm ON tm.trip_id = p_trip_id AND tm.profile_id = sc.player_id
    WHERE sc.round_id = p_round_id AND sc.player_id <> p_player_id AND sc.status <> 'withdrawn'
      AND v_claimant_group IS NOT NULL AND tm.group_id = v_claimant_group
    ORDER BY sc.player_id LIMIT 1;

  IF v_other_player IS NOT NULL THEN
    RETURN QUERY SELECT v_other_player, 'organiser_fallback'::TEXT; -- still "no marker" fallback, just resolved to a co-player rather than the claimant themselves
    RETURN;
  END IF;

  RETURN QUERY SELECT p_player_id, 'self_verified_fallback'::TEXT; -- genuinely nobody else — rare, explicitly flagged, never silent
END;
$$;

NOTIFY pgrst, 'reload schema';
