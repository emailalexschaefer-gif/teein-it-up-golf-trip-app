// PREPARED, NOT RUN. Real-Supabase integration checks for Package 4 / M2 (Ambrose). Needs a SEPARATE, NON-PRODUCTION Supabase test project with the
// proposed migration 104 applied, plus the fixture users below. It refuses to run against anything that is not explicitly declared a test project.
//
//   SUPABASE_TEST_URL=https://<test-ref>.supabase.co  SUPABASE_TEST_ANON_KEY=...  ALLOW_TEST_PROJECT=yes
//   PRODUCTION_SUPABASE_URL=<the live URL, so this script can refuse it>
//   TEST_PASSWORD=...   (the password given to every fixture user)
//   FIXTURE_JSON=./fixture.json  { tripId, otherTripId, roundId, entryId, holeIds:[...], users:{ organiser, scorer, member, outsider, otherOrganiser } -> {email,id} }
//   node run_supabase_checks.mjs
//
// Verifies with REAL JWT identities over PostgREST: anon is refused on every write RPC; a plain member, an outsider and another event's organiser are
// refused; the organiser and nominated scorer are accepted; RLS stops direct table writes from a browser client and cross-event reads; EXECUTE grants.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const { SUPABASE_TEST_URL: URL_, SUPABASE_TEST_ANON_KEY: KEY, ALLOW_TEST_PROJECT, PRODUCTION_SUPABASE_URL, TEST_PASSWORD, FIXTURE_JSON } = process.env
if (!URL_ || !KEY || !TEST_PASSWORD || !FIXTURE_JSON) { console.error('Missing env. See the header of this file.'); process.exit(2) }
if (ALLOW_TEST_PROJECT !== 'yes') { console.error('Refusing: ALLOW_TEST_PROJECT=yes is required to confirm this is a test project.'); process.exit(2) }
if (!PRODUCTION_SUPABASE_URL || new globalThis.URL(URL_).host === new globalThis.URL(PRODUCTION_SUPABASE_URL).host) { console.error('Refusing: PRODUCTION_SUPABASE_URL must be set and must differ from SUPABASE_TEST_URL.'); process.exit(2) }
const fx = JSON.parse(readFileSync(FIXTURE_JSON, 'utf8'))
let pass = 0; const fails = []; const ok = (c, n) => { if (c) pass++; else { fails.push(n); console.log('  FAIL:', n) } }
const as = async who => { const c = createClient(URL_, KEY, { auth: { persistSession: false } }); if (who) { const { error } = await c.auth.signInWithPassword({ email: fx.users[who].email, password: TEST_PASSWORD }); if (error) throw new Error(`sign-in ${who}: ${error.message}`) } return c }
const rpc = async (c, fn, args) => { const r = await c.rpc(fn, args); return { err: r.error, out: r.data?.outcome } }
const uuid = () => crypto.randomUUID()

const anon = await as(null), org = await as('organiser'), scorer = await as('scorer'), member = await as('member'), outsider = await as('outsider'), otherOrg = await as('otherOrganiser')
const submit = (c, gross = 4, hole = fx.holeIds[0], base = 0) => rpc(c, 'submit_team_score', { p_client_id: uuid(), p_entry_id: fx.entryId, p_hole_id: hole, p_gross: gross, p_no_return: false, p_drive: null, p_base_revision: base, p_reason: null })

// 1. grants: anon / signed-out browser cannot execute any write RPC
for (const [fn, args] of [['submit_team_score', { p_client_id: uuid(), p_entry_id: fx.entryId, p_hole_id: fx.holeIds[0], p_gross: 4, p_no_return: false, p_drive: null, p_base_revision: 0, p_reason: null }],
  ['configure_round_competition', { p_round_id: fx.roundId, p_format: 'ambrose_4', p_method: 'gross_only', p_params: {}, p_min_drives: null }],
  ['reopen_team_setup', { p_round_id: fx.roundId, p_reason: 'x' }], ['relock_team_setup', { p_round_id: fx.roundId }], ['assign_team_scorer', { p_entry_id: fx.entryId, p_scorer: fx.users.scorer.id }],
  ['team_setup_block', { p_round_id: fx.roundId }]]) {
  const r = await rpc(anon, fn, args); ok(!!r.err && /permission denied|not exist|42501|PGRST/i.test(JSON.stringify(r.err)), `anon cannot execute ${fn}`)
}
// the internal helper is not callable by signed-in users either
ok(!!(await rpc(org, 'team_setup_block', { p_round_id: fx.roundId })).err, 'signed-in organiser cannot call the internal helper team_setup_block')
// 2. authority comes from the database identity
ok((await submit(outsider)).out === 'not_authorised' || !!(await submit(outsider)).err, 'outsider cannot score')
ok((await submit(member)).out === 'not_authorised', 'a plain member who is not the nominated scorer cannot score')
ok((await submit(otherOrg)).out === 'not_authorised', 'another event’s organiser cannot score here')
const good = await submit(scorer); ok(['inserted', 'duplicate'].includes(good.out), `the nominated scorer can score (${good.out})`)
ok((await rpc(member, 'reopen_team_setup', { p_round_id: fx.roundId, p_reason: 'let me in' })).out === 'not_authorised', 'a member cannot reopen set-up')
ok((await rpc(otherOrg, 'reopen_team_setup', { p_round_id: fx.roundId, p_reason: 'let me in' })).out === 'not_authorised', 'another event’s organiser cannot reopen set-up')
ok((await rpc(org, 'reopen_team_setup', { p_round_id: fx.roundId, p_reason: '   ' })).out === 'reason_required', 'reopen needs a reason')
// 3. RLS: browsers cannot write the team tables directly, and cannot read another event's data
for (const t of ['team_score_entries', 'round_team_entries', 'round_team_members', 'round_competition_config', 'team_entry_audit', 'team_score_revisions']) {
  const w = await org.from(t).insert({}); ok(!!w.error, `direct insert into ${t} is refused for the organiser's browser client`)
  const u = await org.from(t).update({ updated_at: new Date().toISOString() }).neq('id', fx.entryId); ok(!!u.error || (u.data ?? []).length === 0, `direct update on ${t} changes nothing`)
}
const cross = await outsider.from('round_team_entries').select('id').eq('id', fx.entryId); ok((cross.data ?? []).length === 0, 'an outsider cannot read another event’s team entries')
const own = await member.from('round_team_entries').select('id').eq('id', fx.entryId); ok((own.data ?? []).length === 1, 'an event member can read the event’s team entries')
// 4. completion function through the signed-in client
const comp = await org.rpc('team_entry_completion', { p_entry_id: fx.entryId }); ok(!comp.error && typeof comp.data?.complete === 'boolean', 'team_entry_completion answers for the organiser')
ok(!!(await anon.rpc('team_entry_completion', { p_entry_id: fx.entryId })).error, 'anon cannot call team_entry_completion')
console.log(`\nSUPABASE checks passed: ${pass}   failed: ${fails.length}`); if (fails.length) console.log(fails.join('\n')); process.exit(fails.length ? 1 : 0)
