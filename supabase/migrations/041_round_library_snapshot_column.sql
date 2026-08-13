-- =============================================================================
-- 041_round_library_snapshot_column.sql
-- =============================================================================
-- Course Library v1 — the missing piece for "already-configured future
-- rounds must not change" (not just completed/active ones). If the
-- snapshot were only taken when Begin Round actually runs, a library
-- edit made between round SETUP (the wizard) and Begin Round — which
-- could be days apart — would still leak into the round. This column is
-- populated once, at round setup time, directly from whatever the
-- organiser selected, and never re-read from the library tables again.
-- BeginRoundModal reads this instead of the generic default template
-- when present; nothing else in the app ever queries course_tee_holes
-- for round-display purposes.

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS library_holes_snapshot JSONB;
