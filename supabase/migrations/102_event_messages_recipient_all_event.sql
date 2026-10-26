-- 102: let event_messages accept recipient_type 'all' AS WELL AS 'event' (production already holds 'event' rows).
-- Why: production's event_messages carries an older definition where BOTH
--   event_messages_recipient_type_check        CHECK (recipient_type IN ('event','group','player'))
--   event_messages_recipient_consistency_check CHECK ((recipient_type='event' AND both recipient ids NULL) OR group OR player)
-- reject 'all', so release_round_arrangements() (migration 101) rolls back on its announcement insert (SQLSTATE 23514).
-- Migration 029 only replaces the first constraint, so it is NOT sufficient on its own; this migration fixes both.
-- Effect: widening only. Every existing row (including 'event' rows) still satisfies both constraints; no rows are
-- read, changed or deleted. Does not touch policies (029 owns the read policy; preflight check 34 reports on it).
-- Idempotent. Also drops 025's auto-named table CHECK when present (it is the same consistency rule, replaced below).
BEGIN;
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_type_check
  CHECK (recipient_type IN ('all', 'event', 'group', 'player'));

ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_consistency_check;
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_consistency_check
  CHECK (
    (recipient_type IN ('all', 'event') AND recipient_group_id IS NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'group'  AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL)
  );
NOTIFY pgrst, 'reload schema';
COMMIT;
