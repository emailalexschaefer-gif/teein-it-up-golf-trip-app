-- READ-ONLY. SELECT only. Run in the Supabase SQL editor and send the result grid back. Nothing is modified.
-- Purpose: find which real rounds have the inputs the published Golf Australia Daily Handicap formula needs (slope, course rating, par),
-- and what handicaps were actually stored for them, so the impact can be measured on REAL data. Column names follow
-- 039_course_library.sql, rounds/scorecards in the migrations and src/types/database.ts; if one is rejected send the error text unchanged.
select r.id as round_id, r.name as round_name, r.status, r.holes as configured_holes, r.par, r.course_rating, r.slope_rating,
       count(distinct sc.id) as scorecards,
       min(sc.playing_handicap) as min_stored_playing_hcp, max(sc.playing_handicap) as max_stored_playing_hcp,
       count(se.id) as score_rows, sum(se.stableford_pts) as total_stableford_pts
from rounds r
left join scorecards sc on sc.round_id = r.id
left join score_entries se on se.scorecard_id = sc.id
where r.slope_rating is not null
group by r.id, r.name, r.status, r.holes, r.par, r.course_rating, r.slope_rating
order by r.name;
-- Second grid: how many rounds fall in each situation (no slope = manual course, which never used the slope formula at all).
select (r.slope_rating is not null) as has_slope, (r.course_rating is not null) as has_course_rating, (r.par is not null) as has_par, r.holes as configured_holes, count(*) as rounds
from rounds r group by 1,2,3,4 order by 4,1 desc;
