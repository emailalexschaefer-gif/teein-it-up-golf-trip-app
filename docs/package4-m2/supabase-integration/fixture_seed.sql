-- FIXTURE SEED for run_supabase_checks.mjs -- THROWAWAY TEST PROJECT ONLY (never production).
-- 1. In the TEST project's Authentication > Users, add five users (any emails you control, one shared password, "Auto Confirm User" ticked):
--      organiser, scorer, member, outsider, other-organiser
-- 2. Copy each user's UUID into the \set lines below (or pass them with  psql -v organiser=... ).
-- 3. Run:  psql "$TEST_DB_URL" -At -v ON_ERROR_STOP=1 -f fixture_seed.sql | tail -1 > fixture.json
--    (the last line printed is the fixture JSON; the emails inside it are placeholders -- edit them to the real emails before running the checks)
-- It creates two events, one active round with 18 holes, one two-person Ambrose team (scorer + member, scorer confirmed). Uses the real database functions
-- by setting the same JWT claim PostgREST sets, so it exercises set-up as the organiser would.
\set ON_ERROR_STOP on
-- \set organiser '00000000-0000-0000-0000-000000000000'
-- \set scorer '...'  \set member '...'  \set outsider '...'  \set otherorg '...'
BEGIN;
INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, v.n FROM auth.users u JOIN (VALUES (:'organiser'::uuid,'Fixture Organiser'),(:'scorer'::uuid,'Fixture Scorer'),(:'member'::uuid,'Fixture Member'),(:'outsider'::uuid,'Fixture Outsider'),(:'otherorg'::uuid,'Fixture Other Organiser')) v(id,n) ON v.id = u.id
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.trips (id, organiser_id, name, start_date, end_date) VALUES
 ('a0000000-0000-4000-8000-000000000001', :'organiser'::uuid, 'FIXTURE event A', current_date, current_date),
 ('a0000000-0000-4000-8000-000000000002', :'otherorg'::uuid, 'FIXTURE event B', current_date, current_date);
INSERT INTO public.trip_members (trip_id, profile_id, role) VALUES
 ('a0000000-0000-4000-8000-000000000001', :'organiser'::uuid, 'organiser'), ('a0000000-0000-4000-8000-000000000001', :'scorer'::uuid, 'player'), ('a0000000-0000-4000-8000-000000000001', :'member'::uuid, 'player'),
 ('a0000000-0000-4000-8000-000000000002', :'otherorg'::uuid, 'organiser')
ON CONFLICT DO NOTHING;
INSERT INTO public.rounds (id, trip_id, name, play_date, status) VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'FIXTURE round', current_date, 'upcoming');
INSERT INTO public.holes (round_id, hole_number, par, stroke_index) SELECT 'b0000000-0000-4000-8000-000000000001', n, 4, n FROM generate_series(1,18) n;
-- act as the organiser (what PostgREST does with a real session)
SELECT set_config('request.jwt.claim.sub', :'organiser', true), set_config('request.jwt.claims', json_build_object('sub', :'organiser', 'role', 'authenticated')::text, true) \gset
SELECT (public.create_competition_team('a0000000-0000-4000-8000-000000000001', 'Fixture Team'))->>'team_id' AS team_id \gset
SELECT public.configure_round_competition('b0000000-0000-4000-8000-000000000001', 'ambrose_2', 'gross_only', '{}'::jsonb, NULL);
SELECT public.save_round_team_entry('b0000000-0000-4000-8000-000000000001', :'team_id'::uuid, ARRAY[:'scorer'::uuid, :'member'::uuid]);
SELECT e.id AS entry_id FROM public.round_team_entries e WHERE e.round_id = 'b0000000-0000-4000-8000-000000000001' \gset
SELECT public.assign_team_scorer(:'entry_id'::uuid, :'scorer'::uuid);
UPDATE public.rounds SET status = 'active' WHERE id = 'b0000000-0000-4000-8000-000000000001';
COMMIT;
SELECT json_build_object('tripId','a0000000-0000-4000-8000-000000000001','otherTripId','a0000000-0000-4000-8000-000000000002','roundId','b0000000-0000-4000-8000-000000000001',
  'entryId', :'entry_id', 'holeIds', (SELECT json_agg(id ORDER BY hole_number) FROM public.holes WHERE round_id='b0000000-0000-4000-8000-000000000001'),
  'users', json_build_object('organiser', json_build_object('email','organiser@example.test','id',:'organiser'), 'scorer', json_build_object('email','scorer@example.test','id',:'scorer'),
    'member', json_build_object('email','member@example.test','id',:'member'), 'outsider', json_build_object('email','outsider@example.test','id',:'outsider'),
    'otherOrganiser', json_build_object('email','otherorg@example.test','id',:'otherorg')));
