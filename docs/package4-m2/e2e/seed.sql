-- Scratch seed: one event, one organiser, 16 players in 4 playing groups, an 18-hole round and a 9-hole round. Fixture data only.
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
INSERT INTO profiles (id, full_name) VALUES ('a0000000-0000-0000-0000-000000000001', 'Olive Organiser');
INSERT INTO profiles (id, full_name)
  SELECT ('b0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
         (ARRAY['Alex Ford','Daz Hill','Sam Reid','Jo Park','Lee Chan','Kim Ng','Pat Doyle','Max Tran','Ivy Cole','Ben Ashe','Zoe Lim','Tom Bell','Amy Fox','Ray Moss','Eve Hart','Ned Pike'])[n]
  FROM generate_series(1,16) n;
INSERT INTO trips (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Scratch Charity Day');
INSERT INTO trip_members (trip_id, profile_id, role) VALUES ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'organiser');
INSERT INTO trip_members (trip_id, profile_id, role) SELECT '10000000-0000-0000-0000-000000000001', id, 'member' FROM profiles WHERE id::text LIKE 'b0000000%';
INSERT INTO trip_groups (id, trip_id, name) SELECT ('60000000-0000-0000-0000-00000000000' || n)::uuid, '10000000-0000-0000-0000-000000000001', 'Group ' || n FROM generate_series(1,4) n;
INSERT INTO rounds (id, trip_id, status) VALUES ('20000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'upcoming'), ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'upcoming');
INSERT INTO holes (round_id, hole_number, par) SELECT '20000000-0000-0000-0000-000000000018', n, (ARRAY[4,3,5])[1 + n % 3] FROM generate_series(1,18) n;
INSERT INTO holes (round_id, hole_number, par) SELECT '20000000-0000-0000-0000-000000000009', n, (ARRAY[4,3,5])[1 + n % 3] FROM generate_series(1,9) n;
-- playing groups: members 1-4 in Group 1, 5-8 in Group 2, ... in profile-id order (slot order)
UPDATE trip_members m SET group_id = ('60000000-0000-0000-0000-00000000000' || ((x.n - 1) / 4 + 1))::uuid
  FROM (SELECT profile_id, row_number() OVER (ORDER BY profile_id) n FROM trip_members WHERE role = 'member') x WHERE m.profile_id = x.profile_id;
-- a second 18-hole round for the two-person Ambrose scenario
INSERT INTO rounds (id, trip_id, status) VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'upcoming');
INSERT INTO holes (round_id, hole_number, par) SELECT '20000000-0000-0000-0000-000000000002', n, (ARRAY[4,3,5])[1 + n % 3] FROM generate_series(1,18) n;
