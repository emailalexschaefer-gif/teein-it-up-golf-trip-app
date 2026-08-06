-- =============================================================================
-- diagnose_dave_alex_scorecard_gap.sql
-- =============================================================================
-- Read-only diagnostic query for the "Dave & Alex Friday Series" trip —
-- the specific trip where the same test account that works correctly in
-- a fresh trip fails with "scorecard hasn't been set up." Since the
-- identical account and identical app code behave differently between a
-- fresh trip and this one, the discrepancy is in this trip's actual
-- data, not in application logic — this query shows that data directly,
-- side by side, which is faster than a deploy → reproduce → check-logs
-- cycle for something already confirmed to be data-level.
--
-- HOW TO USE:
-- 1. Find the trip's ID: run the first query below with the trip name.
-- 2. Paste that ID into :trip_id in every query after it (or just
--    replace the CTE at the top once).
-- 3. Run each numbered section and read the output.
-- =============================================================================

-- ── Step 0: Find the trip ID ────────────────────────────────────────────────
select id, name, event_type, status, created_at
from trips
where name ilike '%Friday Series%' or name ilike '%Dave%Alex%';
-- Copy the id from this result into the CTE below.


-- ── Everything else, parameterised by trip_id ───────────────────────────────
with target_trip as (
  select id from trips where name ilike '%Friday Series%' or name ilike '%Dave%Alex%' limit 1
)

-- ── Step 1: Every member of this trip, with their group and role ───────────
-- Look for: is the "TEST" account (or whichever account failed) actually
-- present here? What is its group_id? Is it null, despite the UI showing
-- "Group 1"?
select tm.id as member_id, tm.profile_id, p.full_name, tm.role, tm.group_id,
       tg.name as group_name, tm.playing_handicap, p.handicap as profile_handicap
from trip_members tm
join target_trip t on tm.trip_id = t.id
left join profiles p on p.id = tm.profile_id
left join trip_groups tg on tg.id = tm.group_id
order by tm.role desc, p.full_name;


-- ── Step 2: Every round on this trip, and its status ────────────────────────
-- Look for: more than one round with status 'active' at once (would be
-- unusual and could confuse a query expecting exactly one), or a round
-- whose status doesn't match what the UI showed at the time.
select id as round_id, name, status, holes, play_date, created_at
from rounds r
join target_trip t on r.trip_id = t.id
order by play_date;


-- ── Step 3: Every scorecard for every round on this trip ───────────────────
-- This is the key comparison: cross-reference against Step 1's member
-- list. A member present in Step 1 but ABSENT here, for the round that's
-- currently 'active', is the direct cause of "scorecard hasn't been set
-- up" — this row is what's actually missing.
select sc.id as scorecard_id, sc.round_id, r.name as round_name, r.status as round_status,
       sc.player_id, p.full_name, sc.status as scorecard_status, sc.playing_handicap, sc.submitted_at
from scorecards sc
join rounds r on r.id = sc.round_id
join target_trip t on r.trip_id = t.id
left join profiles p on p.id = sc.player_id
order by r.play_date, p.full_name;


-- ── Step 4: The direct answer — members with no scorecard for the active
--    round ───────────────────────────────────────────────────────────────
-- If this returns any rows, that's the confirmed root cause: these
-- specific players are grouped but have no scorecard row at all for the
-- currently active round. If it returns zero rows, the scorecard exists
-- and the bug is instead in how it's being queried/filtered elsewhere
-- (e.g. an unexpected 'withdrawn' status, or an RLS policy issue) —
-- worth checking scorecard_status in Step 3's output for anything other
-- than 'active' if this comes back empty but the app still shows the
-- error.
select tm.profile_id, p.full_name, tm.group_id, r.id as active_round_id, r.name as round_name
from trip_members tm
join target_trip t on tm.trip_id = t.id
join rounds r on r.trip_id = t.id and r.status = 'active'
left join profiles p on p.id = tm.profile_id
where tm.group_id is not null
  and not exists (
    select 1 from scorecards sc
    where sc.round_id = r.id and sc.player_id = tm.profile_id
  );
