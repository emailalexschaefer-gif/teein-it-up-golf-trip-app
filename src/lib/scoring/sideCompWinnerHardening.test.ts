import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Final hardening pass (9 Sep) -- these are source-scanning contract
// tests, not executed-SQL tests: no live Postgres connection exists in
// this environment. Each test verifies a specific, named correctness
// property is genuinely present in the real migration files' text --
// chosen because each one is exactly the kind of thing that could
// silently regress in a future edit without anyone noticing (the
// idempotency guard being dropped, the win-count switching back to
// verifier/entered_by instead of the actual competitor, the
// integrity trigger being removed) -- not manufactured merely to
// inflate a test count.

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

test('finalize_side_comp_winners: idempotency guard is present in the real migration', () => {
  const sql = readMigration('080_side_comp_official_winners.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  // Extract the actual UPDATE's WHERE clause specifically (not just a
  // whole-file search) to confirm the guard genuinely gates the write
  // itself, not merely appears somewhere in the file's comments.
  const updateMatch = codeOnly.match(/UPDATE public\.side_comps sc[\s\S]*?WHERE([\s\S]*?)RETURNING/)
  assert.ok(updateMatch, 'the UPDATE statement in finalize_side_comp_winners was not found')
  const whereClause = updateMatch![1]
  assert.match(whereClause, /sc\.round_id\s*=\s*p_round_id/i)
  assert.match(whereClause, /sc\.official_winner_entry_id\s+IS\s+NULL/i)
})

test('my_side_game_wins (082, the deployed version): counts the competitor, not the verifier/enterer', () => {
  const sql = readMigration('082_side_comp_winner_hardening.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  // The win-count join must use side_comp_entries.player_id (the
  // actual competitor whose result this is) as the win recipient --
  // never entered_by, verifier_source, or the authenticated caller.
  // Confirms this by extracting the my_side_game_wins CTE body
  // specifically, not just searching the whole file (which would also
  // match unrelated code).
  const cteMatch = codeOnly.match(/my_side_game_wins AS \(([\s\S]*?)\),\s*latest_badge/)
  assert.ok(cteMatch, 'my_side_game_wins CTE not found in 082')
  const cteBody = cteMatch![1]
  assert.match(cteBody, /sce\.player_id\s*=\s*p_player_id/i)
  assert.doesNotMatch(cteBody, /entered_by/i)
  assert.doesNotMatch(cteBody, /verifier/i)
})

test('my_side_game_wins no longer depends on trip.status (the original multi-round bug)', () => {
  const sql = readMigration('082_side_comp_winner_hardening.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  const cteMatch = codeOnly.match(/my_side_game_wins AS \(([\s\S]*?)\),\s*latest_badge/)
  assert.ok(cteMatch, 'my_side_game_wins CTE not found in 082')
  const cteBody = cteMatch![1]
  // The fixed CTE must key off official_winner_entry_id directly, and
  // must not filter on t.status at all (the exact bug this whole
  // package exists to fix).
  assert.match(cteBody, /official_winner_entry_id/i)
  assert.doesNotMatch(cteBody, /t\.status\s*=\s*'completed'/i)
})

test('self-healing retry: get_my_golf_summary calls finalize_side_comp_winners before counting wins', () => {
  const sql = readMigration('082_side_comp_winner_hardening.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  const callIndex = codeOnly.indexOf('PERFORM public.finalize_side_comp_winners')
  const returnQueryIndex = codeOnly.indexOf('RETURN QUERY')
  assert.ok(callIndex > -1, 'self-healing call to finalize_side_comp_winners not found')
  assert.ok(returnQueryIndex > callIndex, 'the reconciliation call must happen before the win count is computed, not after')
})

test('self-healing retry is scoped to completed rounds only, never live ones', () => {
  const sql = readMigration('082_side_comp_winner_hardening.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  const loopMatch = codeOnly.match(/FOR v_round IN([\s\S]*?)LOOP/)
  assert.ok(loopMatch, 'self-healing FOR loop not found')
  assert.match(loopMatch![1], /r\.status\s*=\s*'completed'/i)
})

test('integrity trigger: rejects an official_winner_entry_id belonging to a different side_comp', () => {
  const sql = readMigration('082_side_comp_winner_hardening.sql')
  const codeOnly = sql.replace(/--.*$/gm, '')
  assert.match(codeOnly, /CREATE TRIGGER side_comps_winner_integrity/i)
  assert.match(codeOnly, /BEFORE INSERT OR UPDATE OF official_winner_entry_id ON public\.side_comps/i)
  // The function body itself must actually compare the referenced
  // entry's own side_comp_id against this row's id, not just exist as
  // a named trigger with no real check inside it.
  const fnMatch = codeOnly.match(/enforce_side_comp_winner_integrity\(\)[\s\S]*?RETURNS TRIGGER[\s\S]*?\$\$([\s\S]*?)\$\$/)
  assert.ok(fnMatch, 'enforce_side_comp_winner_integrity function body not found')
  assert.match(fnMatch![1], /v_entry_side_comp_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.id/i)
  assert.match(fnMatch![1], /RAISE EXCEPTION/i)
})

test('the redeclared get_my_golf_summary WITH-query body is otherwise unchanged from 081 (only the self-heal step was added)', () => {
  const sql081 = readMigration('081_my_golf_summary_official_side_game_wins.sql')
  const sql082 = readMigration('082_side_comp_winner_hardening.sql')
  const body081 = sql081.slice(sql081.indexOf('RETURN QUERY'))
  const body082 = sql082.slice(sql082.indexOf('RETURN QUERY'))
  assert.equal(body081.trim(), body082.trim())
})
