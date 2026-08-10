-- =============================================================================
-- diagnose_stuck_sync_scorecards_v2.sql
-- =============================================================================
-- Fully self-contained — no placeholders, no manual UUID substitution.
-- Paste this whole block into the Supabase SQL Editor and run it as-is.
--
-- Read-only throughout: every statement below is a SELECT. No UPDATE,
-- DELETE, INSERT, or schema change anywhere in this file.
--
-- Automatically identifies the most recently completed round and
-- reports, for every scorecard on it, whether the expected number of
-- 'self' score_entries actually exist — this is what directly answers
-- "did the six scores genuinely fail to reach Supabase, or did they
-- persist while the client-side pending counter was simply stale."
--
-- Run both queries below together (select-all, run) — the SQL Editor
-- shows one result set per statement.
-- =============================================================================

-- ── Query 1: which round did this diagnostic pick? Confirm this
--    matches the round you actually tested before reading Query 2. ─────────
with target_round as (
  select r.id, r.name, r.holes as expected_holes, r.round_number, r.trip_id, r.created_at
  from rounds r
  where r.status = 'completed'
  order by r.created_at desc
  limit 1
)
select
  tr.id as round_id,
  tr.name as round_name,
  tr.round_number,
  t.name as trip_name,
  tr.expected_holes,
  tr.created_at
from target_round tr
join trips t on t.id = tr.trip_id;


-- ── Query 2: the actual answer — for every scorecard on that same
--    round, expected holes vs. actual persisted 'self' score_entries. ──────
with target_round as (
  select r.id, r.holes as expected_holes
  from rounds r
  where r.status = 'completed'
  order by r.created_at desc
  limit 1
)
select
  sc.id as scorecard_id,
  p.full_name,
  sc.status as scorecard_status,
  tr.expected_holes,
  count(se.id) filter (where se.capture_role = 'self') as actual_self_entries,
  tr.expected_holes - count(se.id) filter (where se.capture_role = 'self') as missing_entries
from scorecards sc
join target_round tr on tr.id = sc.round_id
join profiles p on p.id = sc.player_id
left join score_entries se on se.scorecard_id = sc.id
group by sc.id, p.full_name, sc.status, tr.expected_holes
order by missing_entries desc;

-- =============================================================================
-- HOW TO READ THE RESULTS
-- =============================================================================
-- Query 1 confirms which round this diagnostic picked automatically —
-- check the round_name/round_number/trip_name match the round you
-- actually tested. If it picked the wrong one (e.g. you've since
-- completed a different round in a different trip), let me know and
-- I'll adjust the selection logic rather than have you edit UUIDs by
-- hand.
--
-- Query 2 is the real answer:
--   missing_entries = 0 for every row -> every score genuinely reached
--     Supabase. The "6 scores still syncing" message was a stale
--     client-side counter (the bug already fixed in the last code
--     pass), not real data loss.
--   missing_entries > 0 for any row -> those specific holes really are
--     missing server-side for that player. Send that row back (the
--     scorecard_id and full_name are enough) and a follow-up query can
--     identify exactly which hole numbers are missing.
-- =============================================================================
