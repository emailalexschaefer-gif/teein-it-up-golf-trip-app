-- 096_shared_presentations.sql
-- Release 3S — durable, shareable event presentations.
--
-- ADDITIVE ONLY. Creates one new table. Nothing existing is altered, so the
-- previous application version keeps working unchanged if this table stays
-- unused, and rolling back the application never requires undoing this
-- migration. (Rollback of the table itself, if ever wanted: DROP TABLE
-- public.shared_presentations;)
--
-- ACCESS MODEL: Row Level Security is ENABLED and NO policies are created, so
-- the browser (anon/authenticated keys) can neither read nor write this
-- table — not even the tokens or snapshots. Only the server (service-role
-- key, used by the app's API routes after its own authorisation checks) can
-- reach it. This is deliberate: the share token is the credential.

CREATE TABLE IF NOT EXISTS public.shared_presentations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  -- 'event' for the final-event presentation. Reserved for later per-round
  -- presentations ('round:<round id>') without any redesign.
  scope_key                   TEXT        NOT NULL DEFAULT 'event',
  -- 256-bit random token (43 URL-safe characters), generated server-side.
  token                       TEXT        NOT NULL UNIQUE CHECK (char_length(token) >= 32),
  title                       TEXT        NOT NULL,
  status                      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- Two privacy-filtered decks built by the existing deck engine at publish
  -- time. Media is referenced by Moment id (never a storage path or signed
  -- URL). 'event_deck' is for authenticated event members; 'public_deck' is
  -- for the open link and contains only media approved for public sharing.
  event_deck                  JSONB       NOT NULL,
  public_deck                 JSONB       NOT NULL,
  duration_seconds            INTEGER     NOT NULL DEFAULT 8 CHECK (duration_seconds IN (5, 8, 10)),
  -- The ONLY Moment ids each audience's media endpoint will serve.
  approved_event_moment_ids   UUID[]      NOT NULL DEFAULT '{}',
  approved_public_moment_ids  UUID[]      NOT NULL DEFAULT '{}',
  -- What was left out of the public version and why (for the organiser).
  excluded_summary            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Public (outside-the-event) access is OFF unless the organiser explicitly
  -- confirms the media has been cleared for sharing when publishing.
  public_enabled              BOOLEAN     NOT NULL DEFAULT false,
  public_cleared_at           TIMESTAMPTZ,
  public_name_mode            TEXT        NOT NULL DEFAULT 'initials' CHECK (public_name_mode IN ('initials', 'full')),
  version                     INTEGER     NOT NULL DEFAULT 1,
  published_by                UUID        NOT NULL REFERENCES public.profiles(id),
  published_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                  TIMESTAMPTZ,
  -- The single automatic Event Chat message for this publication.
  chat_message_id             UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One ACTIVE presentation per event per scope. A revoked row stays for audit
-- and is never reactivated; publishing again after a revoke creates a new row
-- with a new token.
CREATE UNIQUE INDEX IF NOT EXISTS shared_presentations_one_active_per_scope
  ON public.shared_presentations (trip_id, scope_key) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS shared_presentations_trip_idx
  ON public.shared_presentations (trip_id, published_at DESC);

ALTER TABLE public.shared_presentations ENABLE ROW LEVEL SECURITY;
-- (intentionally no policies — service role only)
