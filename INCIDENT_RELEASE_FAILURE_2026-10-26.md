# Field-test bug #2 — Confirm & Release fails ("Could not release this round. Nothing was changed.")

## Root cause (CONFIRMED against production on 26 Oct 2026 by read-only queries)
The initial release posts one Event Chat announcement with `recipient_type = 'all'`. Production's `event_messages` carries an older definition where **two** CHECK constraints only know `'event'`:

| Constraint (production) | Stale definition | Effect |
|---|---|---|
| `event_messages_recipient_type_check` | `recipient_type IN ('event','group','player')` | rejects `'all'` |
| `event_messages_recipient_consistency_check` | `(recipient_type = 'event' AND both recipient ids NULL) OR …` | rejects `'all'` |

`release_round_arrangements()` (migration 101) inserts the announcement, the insert raises SQLSTATE 23514, and the whole transaction rolls back — hence "Nothing was changed". Preflight check 33 = FAIL; checks 30, 31, 32, 34 = OK. The 9-hole / start-hole-10 / two-player shape is **not** a factor (reproduced releasing correctly on a scratch PostgreSQL).

**Correction to an earlier note:** migration 029 only replaces the first constraint. Applied alone it would NOT fix this (reproduced; `supabase/tests/102_production_chat_constraints.test.sql`, part a). Do not run 029 or `supabase/event_messages_deploy.sql` for this.

## Fix — migration 102 (needs your explicit approval; nothing has been applied by me)
`supabase/migrations/102_event_messages_recipient_all_event.sql`: in one transaction it re-creates the two named constraints so `'all'` AND `'event'` are accepted, keeping the group/player rules exactly as before. Widening only: every existing row (including `'event'` rows) still passes; no rows or policies are changed; idempotent.

## Code changes in this build (safe, additive)
- The release route reports an outdated chat schema plainly ("migration 102 has not been applied", 503, nothing changed) and otherwise appends a SQLSTATE reference `(ref XXXXX)`; the server log includes code, message, details and hint. Failure never marks anything released and never falls back to another path.
- Preflight checks 33/34 detect this exact condition (33 inspects every `recipient_type` constraint).

## Re-test
After 102 is applied and preflight check 33 = OK: same event → Round 1 → Confirm & Release → expect "Released to Players (version 1)", players see their arrangement, one chat announcement, scoring still locked until Start Round. If it still fails, send the `(ref …)` code.
