-- ROLLBACK for 104_competition_teams (Package 4 / Ambrose).
-- Removes ONLY the objects 104 created. Touches no pre-existing table, function, trigger, policy or grant.
-- DESTRUCTIVE for Ambrose data: every team, team entry, team score, flag and audit row is deleted.
-- Ordinary Stableford data is not referenced by any of these objects and is unaffected.
-- Run only if 104 must be undone. Application-file rollback does NOT undo the database; this does.
-- Tested: applied after 104 on a replay of migrations 001-103, the catalog snapshot returned to the pre-104 state exactly.
BEGIN;
DROP TABLE IF EXISTS public.team_entry_audit, public.team_score_flags, public.team_score_revisions,
  public.team_score_entries, public.round_team_members, public.round_team_entries,
  public.round_competition_config, public.competition_teams CASCADE;
DROP FUNCTION IF EXISTS public.submit_team_score(text,uuid,uuid,integer,boolean,uuid,integer,text);
DROP FUNCTION IF EXISTS public.assign_team_scorer(uuid,uuid);
DROP FUNCTION IF EXISTS public.release_team_override_lock(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.resolve_team_no_return(uuid,uuid,integer,text);
DROP FUNCTION IF EXISTS public.raise_team_score_flag(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.resolve_team_score_flag(uuid,text,text);
DROP FUNCTION IF EXISTS public.waive_team_drive_requirement(uuid,text);
DROP FUNCTION IF EXISTS public.team_entry_completion(uuid);
DROP FUNCTION IF EXISTS public.create_competition_team(uuid,text,text);
DROP FUNCTION IF EXISTS public.team_setup_block(uuid);
DROP FUNCTION IF EXISTS public.configure_round_competition(uuid,text,text,jsonb,integer);
DROP FUNCTION IF EXISTS public.save_round_team_entry(uuid,uuid,uuid[],uuid);
DROP FUNCTION IF EXISTS public.lock_team_handicap(uuid,numeric,jsonb);
DROP FUNCTION IF EXISTS public.reopen_team_setup(uuid,text);
DROP FUNCTION IF EXISTS public.relock_team_setup(uuid);
DROP FUNCTION IF EXISTS public.team_score_revisions_immutable();
COMMIT;
