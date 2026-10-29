-- READ-ONLY. SELECT only. Run in the Supabase SQL editor; send the result grid back.
-- Purpose: for every round configured as 9 holes, show what handicap snapshot and
-- Stableford points the production trigger actually stored. Nothing is modified.
-- (Column names follow migrations 019/037/052/055 and src/types/database.ts. If one
--  is rejected, send the error text unchanged - do not edit the query to "make it run".)
select r.id as round_id, r.name as round_name, r.holes as configured_holes,
       count(distinct h.id) as hole_rows,
       min(h.stroke_index) as min_si, max(h.stroke_index) as max_si,
       count(distinct sc.id) as scorecards,
       min(sc.playing_handicap) as min_playing_hcp, max(sc.playing_handicap) as max_playing_hcp,
       count(se.id) as score_rows,
       sum(se.stableford_pts) as total_pts
from rounds r
join holes h on h.round_id = r.id
left join scorecards sc on sc.round_id = r.id
left join score_entries se on se.scorecard_id = sc.id
where r.holes = 9
group by r.id, r.name, r.holes
order by r.name;
