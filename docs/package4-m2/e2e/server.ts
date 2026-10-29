// SCRATCH HARNESS (not app code). Runs the REAL route handlers (handleTeamAction / handleTeamStateRead) against the scratch Postgres, acting as the
// signed-in user (SET ROLE authenticated + the user id), so the real SQL functions and row-level security apply. The "session" is a cookie holding a user id:
// this does NOT test Supabase JWT/PostgREST/middleware, which remain outstanding.
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { handleTeamAction } from '@/lib/ambrose/teamRpc'
import { handleTeamStateRead, deriveEntryViews, type RawTeamState } from '@/lib/ambrose/teamState'
const ORG_ID = 'a0000000-0000-0000-0000-000000000001'
import { ACTION_PATHS } from '@/lib/ambrose/teamApi'
import { ambroseCloseVerdict } from '@/lib/ambrose/closeGate'
let FLAG = true   // harness switch for the server-side feature gate (GET /api/e2e/flag?on=0|1)

const DB = 'e2e'
const dir = process.cwd() + '/docs/package4-m2/e2e/'
export const called = new Map<string, number>()

function psql(sql: string): { ok: true; out: string } | { ok: false; code: string; err: string } {
  const r = spawnSync('psql', ['-h', '/var/run/postgresql', '-p', '5499', '-U', 'postgres', '-d', DB, '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { input: sql, encoding: 'utf8' })
  if (r.status === 0) return { ok: true, out: r.stdout.trim() }
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.stderr)
  return { ok: false, code: m?.[1] ?? 'XX000', err: r.stderr }
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const TYPE: Record<string, string> = { p_client_id: 'text', p_gross: 'int', p_no_return: 'boolean', p_base_revision: 'int', p_reason: 'text', p_note: 'text', p_name: 'text', p_colour: 'text',
  p_format: 'text', p_method: 'text', p_status: 'text', p_params: 'jsonb', p_record: 'jsonb', p_members: 'uuid[]', p_team_handicap: 'numeric', p_min_drives: 'int' }
function lit(k: string, v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  const t = TYPE[k] ?? 'uuid'
  if (t === 'jsonb') return `${q(JSON.stringify(v))}::jsonb`
  if (t === 'uuid[]') return `ARRAY[${(v as string[]).map(x => q(x)).join(',')}]::uuid[]`
  if (t === 'int' || t === 'numeric') return `${Number(v)}::${t}`
  if (t === 'boolean') return v ? 'true' : 'false'
  return `${q(String(v))}::${t}`
}
const asUser = (uid: string | null, select: string) => `SET app.uid = ${q(uid ?? '')}; SET ROLE authenticated; ${select};`

function rpc(uid: string | null) {
  return async (fn: string, args: Record<string, unknown>) => {
    called.set(fn, (called.get(fn) ?? 0) + 1)
    const call = `SELECT public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(k, v)}`).join(', ')})`
    const r = psql(asUser(uid, call))
    if (!r.ok) return { data: null, error: { code: r.code, message: r.err } }
    return { data: JSON.parse(r.out), error: null }
  }
}

function loadState(uid: string | null, roundId: string): RawTeamState | null {
  const R = q(roundId)
  const sql = `SELECT json_build_object(
   'round', (SELECT row_to_json(x) FROM (SELECT id, trip_id, status, setup_released FROM rounds WHERE id=${R}::uuid) x),
   'holes', COALESCE((SELECT json_agg(x) FROM (SELECT id, hole_number, par FROM holes WHERE round_id=${R}::uuid ORDER BY hole_number) x),'[]'),
   'config', (SELECT row_to_json(x) FROM (SELECT format, team_size, handicap_method, min_drives_per_player, setup_reopened_at FROM round_competition_config WHERE round_id=${R}::uuid) x),
   'entries', COALESCE((SELECT json_agg(x) FROM (SELECT id, team_id, entry_name, nominated_scorer_id, scorer_confirmed_at, handicap_locked_at, team_handicap, status, drive_requirement_waived_at, group_id FROM round_team_entries WHERE round_id=${R}::uuid) x),'[]'),
   'members', COALESCE((SELECT json_agg(x) FROM (SELECT entry_id, player_id, position FROM round_team_members WHERE round_id=${R}::uuid) x),'[]'),
   'teams', COALESCE((SELECT json_agg(x) FROM (SELECT id, name FROM competition_teams WHERE status='active' AND trip_id=(SELECT trip_id FROM rounds WHERE id=${R}::uuid)) x),'[]'),
   'scores', COALESCE((SELECT json_agg(x) FROM (SELECT s.entry_id, s.hole_id, s.gross_score, s.is_no_return, s.nr_treatment, s.revision, s.admin_overridden, s.drive_player_id FROM team_score_entries s JOIN round_team_entries e ON e.id=s.entry_id WHERE e.round_id=${R}::uuid) x),'[]'),
   'flags', COALESCE((SELECT json_agg(x) FROM (SELECT f.id, f.entry_id, f.hole_id, f.status FROM team_score_flags f JOIN round_team_entries e ON e.id=f.entry_id WHERE e.round_id=${R}::uuid) x),'[]'),
   'sqlCompletion', COALESCE((SELECT json_object_agg(e.id, public.team_entry_completion(e.id)) FROM round_team_entries e WHERE e.round_id=${R}::uuid),'{}'),
   'names', COALESCE((SELECT json_object_agg(p.id, p.full_name) FROM profiles p WHERE p.id IN (SELECT player_id FROM round_team_members WHERE round_id=${R}::uuid)),'{}')
  )`
  const r = psql(asUser(uid, sql))
  if (!r.ok) throw new Error(r.err)
  const j = JSON.parse(r.out) as RawTeamState
  return j.round ? j : null
}

const byPath = Object.fromEntries(Object.entries(ACTION_PATHS).map(([a, p]) => [p, a])) as Record<string, keyof typeof ACTION_PATHS>
const uidOf = (req: http.IncomingMessage) => /(?:^|;\s*)uid=([0-9a-f-]{36})/.exec(req.headers.cookie ?? '')?.[1] ?? null
const send = (res: http.ServerResponse, status: number, body: unknown, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x'); const uid = uidOf(req)
  try {
    if (url.pathname === '/' ) return send(res, 200, readFileSync(dir + 'index.html', 'utf8'), 'text/html')
    if (url.pathname === '/out.js') return send(res, 200, readFileSync(dir + 'out.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/e2e/agree') { // harness only: does the TypeScript completion rule agree with the database function?
      const st = loadState(ORG_ID, url.searchParams.get('round') ?? ''); if (!st) return send(res, 404, {})
      return send(res, 200, deriveEntryViews(st).map(v => ({ name: v.name, mismatch: v.completionMismatch, complete: v.completion.complete })))
    }
    if (url.pathname === '/api/e2e/flag') { FLAG = url.searchParams.get('on') !== '0'; return send(res, 200, { flag: FLAG }) }
    if (url.pathname === '/api/e2e/called') return send(res, 200, [...called.entries()])
    if (url.pathname === '/api/e2e/sql' && req.method === 'POST') { // harness only: superuser SQL for setup/close-round
      let b = ''; for await (const c of req) b += c
      const r = psql(String(JSON.parse(b).sql)); return send(res, r.ok ? 200 : 500, r.ok ? { out: r.out } : { err: r.err })
    }
    if (url.pathname.startsWith('/api/')) {
      // like the real middleware: a signed-out API call gets a machine-readable 401, never a redirect
      if (!uid) return send(res, 401, { error: 'Not authenticated' })
      if (url.pathname === '/api/team-state') {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' })
        const r = await handleTeamStateRead(url.searchParams.get('round_id'), { getUser: async () => ({ id: uid }), load: async id => loadState(uid, id), enabled: () => FLAG })
        return send(res, r.status, r.body)
      }
      // HARNESS EQUIVALENT of the existing My HQ endpoints this feature relies on (the real Next.js routes cannot run in this sandbox):
      //   GET  setup-context  -> groups with their players in profile order
      //   POST close          -> organiser check + active check + the Ambrose branch (REAL ambroseCloseVerdict over REAL team_entry_completion()) + status update
      const sc = /^\/api\/trips\/([0-9a-f-]{36})\/rounds\/([0-9a-f-]{36})\/(setup-context|close)$/.exec(url.pathname)
      if (sc) {
        const [, tripId, roundId, what] = sc
        if (what === 'setup-context') {
          const r = psql(`SELECT COALESCE(json_agg(g ORDER BY g.name),'[]') FROM (SELECT tg.id, tg.name, COALESCE((SELECT json_agg(json_build_object('profile_id', m.profile_id, 'full_name', p.full_name, 'playing_handicap', NULL, 'profile_handicap', NULL) ORDER BY m.profile_id) FROM trip_members m JOIN profiles p ON p.id=m.profile_id WHERE m.group_id=tg.id),'[]') players FROM trip_groups tg WHERE tg.trip_id=${q(tripId)}::uuid) g`)
          return send(res, 200, { groups: r.ok ? JSON.parse(r.out) : [] })
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' })
        const org = psql(asUser(uid, `SELECT public.is_trip_organiser(${q(tripId)}::uuid)`))
        if (!org.ok || !/t$/.test(org.out)) return send(res, 403, { error: 'Only the organiser can close a round.' })
        const st = psql(`SELECT status FROM rounds WHERE id=${q(roundId)}::uuid AND trip_id=${q(tripId)}::uuid`)
        if (!st.ok || st.out !== 'active') return send(res, 409, { error: 'Only an active round can be closed.' })
        if (FLAG) {
          const ents = psql(`SELECT COALESCE(json_agg(json_build_object('id', id, 'entry_name', entry_name, 'status', status)),'[]') FROM round_team_entries WHERE round_id=${q(roundId)}::uuid`)
          const list = JSON.parse(ents.ok ? ents.out : '[]') as { id: string; entry_name: string; status: string }[]
          const checked = []
          for (const en of list) { const c = await rpc(uid)('team_entry_completion', { p_entry_id: en.id }); checked.push({ name: en.entry_name, withdrawn: en.status === 'withdrawn', completion: c.error ? null : c.data as { complete?: boolean } }) }
          const v = ambroseCloseVerdict(checked); if (!v.ok) return send(res, 409, { error: v.reason, incomplete: v.incomplete })
        }
        psql(`UPDATE rounds SET status='completed' WHERE id=${q(roundId)}::uuid`)
        return send(res, 200, { ok: true })
      }
      const action = byPath[url.pathname]
      if (action) {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' })
        let b = ''; for await (const c of req) b += c
        let body: unknown; try { body = JSON.parse(b) } catch { return send(res, 400, { error: 'Invalid JSON' }) }
        const r = await handleTeamAction(action, body, { getUser: async () => ({ id: uid }), rpc: rpc(uid), enabled: () => FLAG })
        return send(res, r.status, r.body)
      }
    }
    send(res, 404, { error: 'not found' })
  } catch (e) { send(res, 500, { error: String(e) }) }
}).listen(3999, () => console.log('e2e harness server on 3999'))
void existsSync
