-- Proves the database's calculate_stableford_points() (migration 019/037) supports plus handicaps.
-- Plus-2 is stored as -2. Read-only: no tables touched. Mirrors src/lib/scoring/plusHandicapSupport.test.ts.
DO $$
DECLARE
  h INTEGER; si INTEGER; total INTEGER;
  hs INTEGER[] := ARRAY[-4,-2,0,18,36];
  expected INTEGER[] := ARRAY[32,34,36,54,72];
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(hs,1) LOOP
    total := 0;
    FOR si IN 1..18 LOOP total := total + calculate_stableford_points(4, 4, si, hs[i]); END LOOP;
    ASSERT total = expected[i], format('handicap %s: pars-only total %s, expected %s', hs[i], total, expected[i]);
  END LOOP;
  ASSERT calculate_stableford_points(4,4,18,-2) = 1, 'plus-2 on SI 18 gives a stroke back';
  ASSERT calculate_stableford_points(4,4,17,-2) = 1, 'plus-2 on SI 17 gives a stroke back';
  ASSERT calculate_stableford_points(4,4,16,-2) = 2, 'plus-2 on SI 16 unchanged';
  ASSERT calculate_stableford_points(4,4,1,-2)  = 2, 'plus-2 on SI 1 receives nothing';
  ASSERT calculate_stableford_points(4,4,1,2)   = 3, 'handicap +2 strokes (value 2) is different from plus-2 (value -2)';
  ASSERT calculate_stableford_points(4,4,15,-4) = 1 AND calculate_stableford_points(4,4,14,-4) = 2, 'plus-4 gives back on SI 15-18';
  RAISE NOTICE 'PASS database Stableford supports plus handicaps';
END $$;
