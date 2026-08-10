-- =============================================================================
-- diagnose_stuck_sync_scorecards.sql
-- =============================================================================
-- Directly answers "is this serious (data genuinely missing) or just a
-- stale client-side counter" for the "N scores still syncing" bug —
-- rather than guessing, run this against the specific trip/round in
-- question.
-- =============================================================================

-- Step 1: find the round and its expected hole count.
select r.id as round_id, r.name, r.holes as expected_hole_count, r.status
from rounds r
join trips t on t.id = r.trip_id
order by r.created_at desc
limit 10;


-- Step 2: for every scorecard on the round in question, compare actual
-- 'self' score_entries against the expected hole count. Replace
-- :round_id with the id from Step 1.
select
  sc.id as scorecard_id,
  sc.player_id,
  p.full_name,
  sc.status as scorecard_status,
  r.holes as expected_holes,
  count(se.id) filter (where se.capture_role = 'self') as actual_self_entries,
  r.holes - count(se.id) filter (where se.capture_role = 'self') as missing_entries
from scorecards sc
join rounds r on r.id = sc.round_id
join profiles p on p.id = sc.player_id
left join score_entries se on se.scorecard_id = sc.id
where sc.round_id = :'round_id'
group by sc.id, sc.player_id, p.full_name, sc.status, r.holes
order by missing_entries desc;

-- Interpretation:
-- missing_entries = 0 for every row -> all scores genuinely persisted;
--   the "still syncing" message was a stale client-side counter (the
--   Dexie/pendingCount bug fixed in this pass), not real data loss.
-- missing_entries > 0 for a row -> those specific holes really are
--   missing server-side for that player. Cross-reference which
--   hole_numbers are missing with Step 3 below.


-- Step 3 (only if Step 2 shows missing_entries > 0): which specific
-- holes are missing for that scorecard. Replace :scorecard_id.
select h.hole_number
from holes h
where h.round_id = :'round_id'
  and h.hole_number not in (
    select ho.hole_number
    from score_entries se
    join holes ho on ho.id = se.hole_id
    where se.scorecard_id = :'scorecard_id' and se.capture_role = 'self'
  )
order by h.hole_number;
