# Migration 104 (Ambrose) — PENDING. Not in supabase/migrations on purpose.

| File | Purpose |
|---|---|
| `104_PREFLIGHT_readonly.sql` | Read-only. Run on the target database first. Every row must say `ok`. |
| `104_competition_teams.sql` | The migration. One transaction (all or nothing). Additive: 8 new tables, 16 new functions, 1 trigger on a new table, policies/grants on new objects only. |
| `104_POSTFLIGHT_verify_readonly.sql` | Read-only. Run after applying. No `FAIL` rows; policy count must be 8. |
| `104_ROLLBACK.sql` | Removes only what 104 created. Deletes Ambrose data (nothing else). |

Never apply to production without Alex's explicit approval. Order and backup steps: `PRODUCTION_TEST_RUNBOOK_V8.md`.
