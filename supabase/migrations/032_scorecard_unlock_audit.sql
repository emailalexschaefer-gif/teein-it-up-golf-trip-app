-- =============================================================================
-- 032_scorecard_unlock_audit.sql
-- =============================================================================
-- Package 6 — organiser override: unlocking a confirmed scorecard needs
-- an explicit reason and an audit trail. Reusing the existing scorecards
-- table (status/submitted_at already exist from migration 004) rather
-- than a separate audit-log table — this is a single unlock action's
-- record, not a general-purpose event log, so adding one more table for
-- it would be more infrastructure than the requirement needs.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.scorecards ADD COLUMN IF NOT EXISTS unlock_reason TEXT;
ALTER TABLE public.scorecards ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE public.scorecards ADD COLUMN IF NOT EXISTS unlocked_by UUID REFERENCES public.profiles(id);

NOTIFY pgrst, 'reload schema';
