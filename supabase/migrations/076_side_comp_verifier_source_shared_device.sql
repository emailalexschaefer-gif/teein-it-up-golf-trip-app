-- =============================================================================
-- 076_side_comp_verifier_source_shared_device.sql
-- =============================================================================
-- P0 bug-fix package (7 Sep) -- "Side-game claims fail in 1 Digital + 1
-- Paper mode."
--
-- ROOT CAUSE, confirmed by reading the real, currently-deployed schema
-- directly, not assumed: migration 047 added
-- side_comp_entries.verifier_source with
-- `CHECK (verifier_source IN ('marker', 'organiser_fallback',
-- 'self_verified_fallback'))`. Migration 071 (this same engagement,
-- earlier session -- the multi-group verifier-scoping fix) added a
-- FOURTH tier to resolve_side_comp_verifier(), returning
-- 'shared_device_partner' as a new, genuine verifier_source value for
-- exactly the shared-device pairing case -- but never updated this
-- CHECK constraint to allow it. Every claim that resolves through that
-- tier (which is every claim in a 1 Digital + 1 Paper group, whether
-- submitted for the digital player or the paper player, since both
-- resolve to "the other member of this pair" via the same tier) then
-- fails INSERT/UPDATE on side_comp_entries with a genuine Postgres
-- CHECK constraint violation -- surfacing to the client as the generic
-- "Couldn't save your result" every submit_longest_drive_entry /
-- submit_side_comp_value_entry caller already falls back to when the
-- RPC's own error message doesn't match the one specific string
-- ("not currently active") that route checks for.
--
-- This exactly explains every reported symptom: fails for BOTH self
-- and proxy submission in a shared-device pair (both resolve through
-- the same new tier), never reported as broken for a normal
-- Digital<->Digital marker pair or an organiser-fallback scenario
-- (neither of those ever produces this specific verifier_source
-- value), and reproduces the identical generic error text on every
-- attempt regardless of comp type (Nearest the Pin and Longest Drive
-- both call resolve_side_comp_verifier() the same way).
--
-- FIX: the CHECK constraint on side_comp_entries.verifier_source now
-- includes 'shared_device_partner' as a fifth valid value, matching
-- exactly what resolve_side_comp_verifier() has already been
-- returning since migration 071. No change to any RPC, to
-- resolve_side_comp_verifier() itself, or to any application code --
-- the verifier RESOLUTION logic was always correct; only the
-- constraint validating its output was left out of sync with it.
--
-- Postgres's own default naming for an inline column CHECK constraint
-- follows {table}_{column}_check -- confirmed this is the actual
-- constraint name before writing the DROP, rather than assuming it.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.side_comp_entries
  DROP CONSTRAINT IF EXISTS side_comp_entries_verifier_source_check;

ALTER TABLE public.side_comp_entries
  ADD CONSTRAINT side_comp_entries_verifier_source_check
  CHECK (verifier_source IN ('marker', 'organiser_fallback', 'self_verified_fallback', 'shared_device_partner'));

NOTIFY pgrst, 'reload schema';
