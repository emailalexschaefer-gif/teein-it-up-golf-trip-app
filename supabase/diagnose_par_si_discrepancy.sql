-- =============================================================================
-- diagnose_par_si_discrepancy.sql
-- =============================================================================
-- Stage 4 diagnostic — compares stored hole data between the affected
-- event and Darren's working event (same front nine), to produce the
-- requested Hole | Stored Par | Stored SI | Displayed Par | Displayed SI |
-- Data Source table without guessing at live data this sandbox has no
-- access to.
--
-- A plausible contributing factor was found at the code level (see
-- SelfMarkerScoreShell.tsx, "const par = hole?.par ?? 4" / "const si =
-- hole?.stroke_index ?? 1") — if a round's holes array is missing a row
-- for a given hole number (fewer holes actually saved than expected,
-- wrong count, etc.), the scoring screen silently falls back to Par 4 /
-- SI 1 for that hole rather than showing an error, which would produce
-- exactly the reported symptom: early holes correct, later holes wrong,
-- no visible error. This query is what confirms or rules that out
-- against the real data — no code changes made per the explicit "do not
-- change code until identified" instruction.
--
-- HOW TO USE: run each section in order in the Supabase SQL editor.
-- =============================================================================

-- ── Step 0: Find both events/rounds by name ─────────────────────────────────
select r.id as round_id, r.name as round_name, r.holes as configured_hole_count,
       t.id as trip_id, t.name as trip_name, r.status
from rounds r
join trips t on t.id = r.trip_id
order by r.created_at desc
limit 20;
-- Identify the affected round's id and Darren's working round's id from
-- this list, then use them below.


-- ── Step 1: The actual requested table — Holes 1-9 side by side ────────────
-- Replace :affected_round_id and :working_round_id with the two ids from
-- Step 0.
select
  h.hole_number as hole,
  h.par as stored_par,
  h.stroke_index as stored_si,
  'affected event' as data_source
from holes h
where h.round_id = :'affected_round_id'
  and h.hole_number between 1 and 9
union all
select
  h.hole_number as hole,
  h.par as stored_par,
  h.stroke_index as stored_si,
  'darren working event' as data_source
from holes h
where h.round_id = :'working_round_id'
  and h.hole_number between 1 and 9
order by hole, data_source;


-- ── Step 2: Confirm the actual row count matches the round's configured
--    hole count ───────────────────────────────────────────────────────────
-- If this returns fewer rows than round.holes for the affected round
-- (compare against Step 0's configured_hole_count), that's the direct
-- confirmation of the missing-row hypothesis above — any hole number
-- with no corresponding row here is exactly what the scoring screen's
-- silent Par 4/SI 1 fallback would mask.
select r.id as round_id, r.holes as configured_hole_count, count(h.id) as actual_hole_rows,
       array_agg(h.hole_number order by h.hole_number) as hole_numbers_present
from rounds r
left join holes h on h.round_id = r.id
where r.id in (:'affected_round_id', :'working_round_id')
group by r.id, r.holes;


-- ── Step 3: Duplicate or conflicting hole_number rows for the same round ───
-- Should never happen (UNIQUE (round_id, hole_number) constraint), but
-- confirms the constraint is intact rather than assuming it.
select round_id, hole_number, count(*)
from holes
where round_id in (:'affected_round_id', :'working_round_id')
group by round_id, hole_number
having count(*) > 1;
