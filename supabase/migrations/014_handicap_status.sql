-- ─────────────────────────────────────────────────────────────────────────────
-- 014: Add handicap_status to profiles
-- Tracks whether the user has completed the handicap onboarding question.
-- Three states:
--   pending          — never answered (default for new rows)
--   provided         — answered with a real value
--   no_official_handicap — explicitly said they have no official handicap
-- This prevents us from conflating "hasn't answered yet" with
-- "answered null/no handicap", which would cause repeated prompting.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handicap_status TEXT
    NOT NULL DEFAULT 'pending'
    CHECK (handicap_status IN ('pending', 'provided', 'no_official_handicap'));

-- Back-fill: existing rows with a handicap value → 'provided'
UPDATE public.profiles
  SET handicap_status = 'provided'
  WHERE handicap IS NOT NULL
    AND handicap_status = 'pending';

-- Verification:
-- SELECT COUNT(*) FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='profiles'
--   AND column_name='handicap_status';
-- -- Must be 1
