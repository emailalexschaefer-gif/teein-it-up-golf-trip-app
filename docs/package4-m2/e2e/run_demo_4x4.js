// SCRATCH E2E DEMO (Sprint 1): four teams of four players play a full 18-hole Ambrose round, start to finish, through the real screens
// (AmbroseHQSection = the component My HQ mounts; AmbrosePlayerSection = the player round mount), the REAL route handlers and the REAL SQL functions in the
// scratch Postgres. "Confirm & Release" and "Begin Round" are stood in for by scratch SQL (My HQ's Next.js routes cannot run in this sandbox); the Close Round
// endpoint is a harness equivalent running the real ambroseCloseVerdict over the real team_entry_completion(). Session = cookie, NOT a Supabase JWT.
// Not Supabase. Not real Dexie (localStorage shim). Not a device test. Fixture data only.
const { chromium } = require('playwright')
const BASE = 'http://localhost:3999'
const ORG = 'a0000000-0000-0000-0000-000000000001'
const P = n => `b0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const R18 = '20000000-0000-0000-0000-000000000018', R9 = '20000000-0000-0000-0000-000000000009', TRIP = '10000000-0000-0000-0000-000000000001'
const TEAMS = ['Eagles', 'Birdies', 'Albatross', 'Condors']
let pass = 0; const fails = []; const badHttp = []
const ok = (cond, name) => { if (cond) pass++; else { fails.push(name); console.log('  FAIL:', name) } }
const sql = async q => { const r = await fetch(BASE + '/api/e2e/sql', { method: 'POST', body: JSON.stringify({ sql: q }) }); const j = await r.json(); if (!r.ok) throw new Error(j.err); return j.out }
const api = async (uid, path, body, method = 'POST') => { const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: uid ? `uid=${uid}` : '' }, body: method === 'POST' ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch {} return { status: r.status, body: j } }
const stateOf = async (uid, round) => (await api(uid, `/api/team-state?round_id=${round}`, null, 'GET')).body.state
const uuid = () => crypto.randomUUID()
// every team: does the TypeScript completion rule agree with the database function?
const agree = async (round, label) => {
  const a = await (await fetch(`${BASE}/api/e2e/agree?round=${round}`)).json()
  ok(a.length > 0 && a.every(x => Array.isArray(x.mismatch) && x.mismatch.length === 0), `SQL completion agrees with the app rule: ${label} ${JSON.stringify(a.map(x => x.complete))}`)
  return a
}

;(async () => {
  const browser = await chromium.launch()
  const mkPage = async (uid, round, view, vp = { width: 390, height: 844 }) => {
    const ctx = await browser.newContext({ viewport: vp }); if (uid) await ctx.addCookies([{ name: 'uid', value: uid, url: BASE }])
    const page = await ctx.newPage(); page.on('pageerror', e => { fails.push('pageerror ' + e.message); console.log('  PAGEERROR', e.message) })
    page.on('response', r => { const u = r.url(); if (u.includes('/api/') && !u.includes('/api/e2e/') && (r.status() === 405 || r.status() === 404 || r.status() >= 500)) badHttp.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`) })
    await page.goto(`${BASE}/#${view}:${round}`); return { ctx, page }
  }
  const cell = (page, n) => page.locator(`[aria-label^="Hole ${n},"]`)
  const enter = async (page, n, gross, { sync = true } = {}) => {
    await cell(page, n).click(); await page.locator(`[aria-label="Score ${gross}"]`).click()
    await page.waitForFunction(([n, sync]) => { const l = document.querySelector(`[aria-label^="Hole ${n},"]`)?.getAttribute('aria-label') ?? ''; return sync ? /, scored$/.test(l) : /(offline saved|saving|scored)$/.test(l) }, [n, sync], { timeout: 20000 })
  }

  // ---- 0. the server-side feature gate ----
  console.log('0. feature gate')
  await fetch(BASE + '/api/e2e/flag?on=0')
  ok((await api(ORG, `/api/team-state?round_id=${R18}`, null, 'GET')).status === 404, '0a flag off: state read answers 404')
  ok((await api(ORG, '/api/team-entries/configure-round', { round_id: R18, format: 'ambrose_4', method: 'gross_only' })).status === 404, '0b flag off: set-up write answers 404')
  ok((await sql(`select count(*) from round_competition_config where round_id='${R18}'`)) === '0', '0c flag off: nothing was written')
  await fetch(BASE + '/api/e2e/flag?on=1')

  // ---- 1. organiser sets up four teams inside the My HQ section ----
  console.log('1. organiser set-up (My HQ section)')
  const org = await mkPage(ORG, '18', 'hq'); const op = org.page
  await op.getByRole('button', { name: /Set up Ambrose for/ }).click()
  await op.getByText('Choose the Ambrose format').waitFor()
  await op.getByRole('radio', { name: 'Four-person' }).click()
  await op.getByRole('button', { name: 'Use this format' }).click()
  await op.getByText('Ambrose setup').waitFor()
  const cfg = await sql(`select format||'/'||handicap_method from round_competition_config where round_id='${R18}'`)
  ok(cfg === 'ambrose_4/gross_only', `1a gross-only is stored explicitly, not organiser_entered (${cfg})`)
  ok(!(await op.getByRole('button', { name: 'Start scoring' }).count()), '1b there is no Start scoring button that could bypass My HQ')
  ok(await op.getByText(/Finish the steps above, then release and start the round from My HQ/).isVisible(), '1c hand-off text points to My HQ')
  for (let g = 1; g <= 4; g++) {
    await op.locator(`#team-name-60000000-0000-0000-0000-00000000000${g}-0`).fill(TEAMS[g - 1])
    await op.getByRole('button', { name: 'Save team' }).first().click()
    await op.waitForFunction(g => document.querySelectorAll('select[id^=scorer-]').length === g, g, { timeout: 15000 })
  }
  ok((await sql(`select string_agg(entry_name, ',' order by entry_name) from round_team_entries where round_id='${R18}'`)) === 'Albatross,Birdies,Condors,Eagles', '1d saved team names are the organiser’s, not Group 1..4')
  ok((await sql(`select count(*) from round_team_members where round_id='${R18}'`)) === '16', '1e sixteen roster rows')
  for (let i = 0; i < 4; i++) { await op.locator('select[id^=scorer-]').nth(i).selectOption({ index: 1 }); await op.waitForTimeout(400) }
  await op.getByText(/Ready\. Release and start the round from My HQ/).waitFor({ timeout: 15000 }); ok(true, '1f readiness shown once teams + scorers are confirmed')
  await agree(R18, 'before play'); await op.screenshot({ path: 'shot_hq_setup.png', fullPage: true })

  // ---- 2. release (stand-in for My HQ Confirm & Release) -> set-up frozen; audited reopen/relock ----
  console.log('2. release freeze, reopen, relock')
  await sql(`update rounds set setup_released=true where id='${R18}'`)
  const st0 = await stateOf(ORG, R18); const team = n => st0.entries.find(e => e.entry_name === n)
  const locked = await api(ORG, '/api/team-entries/roster', { round_id: R18, team_id: team('Eagles').team_id, member_ids: [P(1), P(2), P(3), P(5)] })
  ok(locked.status === 409 && locked.body.outcome === 'setup_locked', '2a roster is locked once the round is released (Confirm & Release alone, round not yet started)')
  const cfgLocked = await api(ORG, '/api/team-entries/configure-round', { round_id: R18, format: 'ambrose_2', method: 'gross_only' })
  ok(cfgLocked.status === 409 && cfgLocked.body.outcome === 'setup_locked', '2b format is locked once released')
  await op.getByText(/Reopen it \(with a reason\)/).waitFor({ timeout: 15000 }); ok(true, '2c screen explains the lock and offers reopening')
  await op.getByRole('button', { name: /Reopen team set-up/ }).click()
  ok(await op.getByRole('button', { name: 'Reopen set-up' }).isDisabled(), '2d reopening needs a reason')
  await op.getByLabel(/Why is set-up being reopened/).fill('Swapped two players on the sheet'); await op.getByRole('button', { name: 'Reopen set-up' }).click()
  await op.getByRole('button', { name: 'Lock team set-up again' }).waitFor({ timeout: 15000 }); ok(true, '2e organiser reopened with a reason')
  ok((await sql(`select count(*)||':'||min(reason) from team_entry_audit where action='setup_reopened' and entry_id in (select id from round_team_entries where round_id='${R18}')`)) === '4:Swapped two players on the sheet', '2f reopen audited on every team with the reason')
  const nonOrg = await api(P(2), '/api/team-entries/reopen-setup', { round_id: R18, reason: 'let me in' }); ok(nonOrg.status === 403, '2g a player cannot reopen set-up')
  await op.getByRole('button', { name: 'Lock team set-up again' }).click()
  await op.getByRole('button', { name: /Reopen team set-up/ }).waitFor({ timeout: 15000 }); ok(true, '2h organiser locked set-up again')
  ok((await sql(`select count(*) from team_entry_audit where action='setup_relocked' and entry_id in (select id from round_team_entries where round_id='${R18}')`)) === '4', '2i relock audited')

  // ---- 3. not started yet: scorers cannot score; then Begin Round (stand-in) ----
  console.log('3. before and after Begin Round')
  const sc = n => team(TEAMS[n - 1]).nominated_scorer_id
  const pre = await api(sc(1), '/api/team-scores', { client_id: uuid(), entry_id: team('Eagles').id, hole_id: st0.holes[0].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(pre.status === 422 && pre.body.outcome === 'round_closed', '3a a released-but-not-started round refuses scorer writes')
  const early = await mkPage(sc(1), '18', 'player'); await early.page.getByText(/Scoring has not started yet/).waitFor({ timeout: 15000 }); ok(true, '3b scorer sees "scoring has not started"')
  await sql(`update rounds set status='active' where id='${R18}'`)

  // ---- 4. all four teams score 18 holes through the screens; offline conflict (team 2); organiser lock (team 4); No Return (team 1) ----
  console.log('4. play')
  const pages = {}
  for (let n = 1; n <= 4; n++) { pages[n] = await mkPage(sc(n), '18', 'player'); await pages[n].page.getByText('of 18 holes').waitFor({ timeout: 20000 }) }
  // team 1: hole 3 = No Return
  for (let h = 1; h <= 18; h++) {
    if (h === 3) { await cell(pages[1].page, 3).click(); await pages[1].page.getByRole('button', { name: /No Return/ }).click(); await pages[1].page.waitForFunction(() => /no return$/.test(document.querySelector('[aria-label^="Hole 3,"]').getAttribute('aria-label')), null, { timeout: 15000 }); continue }
    await enter(pages[1].page, h, 4)
  }
  await agree(R18, 'team 1 holes in, No Return unresolved')
  let rows = (await stateOf(ORG, R18)).scores.filter(s => s.entry_id === team('Eagles').id)
  ok(rows.length === 18 && rows.find(r => r.is_no_return).gross_score === null, '4a No Return stored without a score')
  // team 3: all 4s except hole 9 = 5
  for (let h = 1; h <= 18; h++) await enter(pages[3].page, h, h === 9 ? 5 : 4)
  // team 2: offline conflict on hole 3
  await enter(pages[2].page, 1, 4); await enter(pages[2].page, 2, 4)
  await pages[2].ctx.setOffline(true); await enter(pages[2].page, 3, 6, { sync: false })
  ok(await pages[2].page.getByText(/waiting to send/).isVisible(), '4b offline score kept and the screen says it is waiting to send')
  const dev2 = await api(sc(2), '/api/team-scores', { client_id: uuid(), entry_id: team('Birdies').id, hole_id: st0.holes[2].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(dev2.status === 200 && dev2.body.revision === 1, '4c second device wrote hole 3 first')
  await pages[2].ctx.setOffline(false)
  await pages[2].page.getByText(/Someone changed this hole to 4/).first().waitFor({ timeout: 25000 }); ok(true, '4d stale offline write became a visible conflict')
  ok((await sql(`select gross_score from team_score_entries where hole_id='${st0.holes[2].id}' and entry_id='${team('Birdies').id}'`)) === '4', '4e server value not overwritten')
  await pages[2].page.getByRole('button', { name: 'Keep their score' }).click()
  await pages[2].page.waitForFunction(() => /, scored$/.test(document.querySelector('[aria-label^="Hole 3,"]').getAttribute('aria-label')), null, { timeout: 15000 })
  for (let h = 4; h <= 18; h++) await enter(pages[2].page, h, 4)
  // team 4: scorer offline on hole 5 while the organiser sets it to 3 with a reason
  for (let h = 1; h <= 4; h++) await enter(pages[4].page, h, 4)
  await pages[4].ctx.setOffline(true); await enter(pages[4].page, 5, 4, { sync: false })
  const ov = await api(ORG, '/api/team-scores', { client_id: uuid(), entry_id: team('Condors').id, hole_id: st0.holes[4].id, gross_score: 3, is_no_return: false, base_revision: 0, reason: 'Rules decision: drop taken, one stroke saved' })
  ok(ov.status === 200 && ov.body.outcome === 'inserted', '4f organiser correction accepted with a reason')
  await pages[4].ctx.setOffline(false)
  await pages[4].page.getByText(/The organiser has set this hole/).first().waitFor({ timeout: 25000 }); ok(true, '4g offline scorer sees the organiser lock instead of overwriting it')
  await pages[4].page.getByRole('button', { name: /Accept the organiser/ }).click()
  await pages[4].page.waitForFunction(() => /(locked)$/.test(document.querySelector('[aria-label^="Hole 5,"]').getAttribute('aria-label')), null, { timeout: 15000 })
  const rel = await api(ORG, '/api/team-scores/unlock', { entry_id: team('Condors').id, hole_id: st0.holes[4].id, reason: 'Ruling recorded; scorer may continue' }); ok(rel.status === 200, '4h organiser released the lock (audited)')
  // scorer reassignment after release is still allowed and audited; the old phone is refused by the database
  const re = await api(ORG, '/api/team-entries/scorer', { entry_id: team('Condors').id, scorer_id: P(14) }); ok(re.status === 200, '4i organiser reassigns the scorer after release')
  const old = await api(sc(4), '/api/team-scores', { client_id: uuid(), entry_id: team('Condors').id, hole_id: st0.holes[5].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(old.status === 403 && old.body.outcome === 'not_authorised', '4j old scorer refused after reassignment')
  ok(Number(await sql(`select count(*) from team_entry_audit where action='scorer_assigned' and entry_id='${team('Condors').id}'`)) >= 2, '4k scorer reassignment audited')
  const t4b = await mkPage(P(14), '18', 'player'); await t4b.page.getByText('of 18 holes').waitFor({ timeout: 20000 })
  for (let h = 6; h <= 18; h++) await enter(t4b.page, h, 4)
  await agree(R18, 'three teams complete, team 1 holding a No Return')

  // ---- 5. organiser tools: No Return -> No Score (stays unranked) -> reasoned score; an open query blocks, then resolves ----
  console.log('5. organiser corrections')
  const op2 = await mkPage(ORG, '18', 'hq'); await op2.page.getByText('Organiser tools').waitFor({ timeout: 20000 })
  const closeBtn = op2.page.getByRole('button', { name: 'Close round' })
  ok(await closeBtn.isDisabled(), '5a Close round disabled while a team is incomplete')
  const early1 = await api(ORG, `/api/trips/${TRIP}/rounds/${R18}/close`, {}); ok(early1.status === 409 && /Eagles/.test(String(early1.body.error)), '5b the close endpoint refuses and names the incomplete team')
  await op2.page.locator('#org-team').selectOption({ label: 'Eagles' })
  await op2.page.getByText(/Hole 3: No Return, waiting for you/).waitFor(); ok(true, '5c organiser sees the unresolved No Return')
  await op2.page.getByLabel('Reason').fill('Team picked up; no score taken'); await op2.page.getByRole('button', { name: 'Record No Score' }).click()
  await op2.page.getByText('Hole 3 recorded as No Score.').waitFor({ timeout: 15000 })
  const a2 = await agree(R18, 'No Score recorded'); ok(a2.find(x => x.name === 'Eagles').complete === false, '5d a No Score hole keeps the team incomplete (app AND database)')
  // an open query on another team blocks too
  const f = await api(P(10), '/api/team-scores/flag', { entry_id: team('Albatross').id, hole_id: st0.holes[8].id, note: 'Was that a 5 or a 4?' }); ok(f.status === 200, '5e team member raised a query')
  const a3 = await agree(R18, 'open query'); ok(a3.find(x => x.name === 'Albatross').complete === false, '5f an open query keeps the team incomplete (app AND database)')
  await op2.page.getByLabel('Hole').selectOption({ label: 'Hole 3' }); await op2.page.getByLabel('New score').fill('5'); await op2.page.getByLabel('Reason').fill('Marker confirmed 5 after review')
  await op2.page.getByRole('button', { name: 'Set score' }).click(); await op2.page.getByText(/Hole 3 set to 5/).waitFor({ timeout: 15000 }); ok(true, '5g organiser applied a reasoned explicit score')
  await op2.page.locator('#org-team').selectOption({ label: 'Albatross' }); await op2.page.getByText(/Query on hole/).waitFor()
  await op2.page.getByLabel('Reason').fill('Checked: score stands'); await op2.page.getByRole('button', { name: 'Resolve' }).click(); await op2.page.getByText('Query resolved.').waitFor({ timeout: 15000 })
  const a4 = await agree(R18, 'all resolved'); ok(a4.length === 4 && a4.every(x => x.complete), '5h all four teams complete in the app AND the database')

  // ---- 6. close from My HQ; closed-round behaviour ----
  console.log('6. close + results')
  const op3 = await mkPage(ORG, '18', 'hq'); await op3.page.getByText('Organiser tools').waitFor({ timeout: 20000 })
  const cb = op3.page.getByRole('button', { name: 'Close round' }); await op3.page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Close round'); return b && !b.disabled }, null, { timeout: 20000 })
  await cb.click(); await op3.page.waitForFunction(() => window.__closed === true, null, { timeout: 15000 })
  ok((await sql(`select status from rounds where id='${R18}'`)) === 'completed', '6a round completed through the close endpoint')
  const afterClose = await api(sc(1), '/api/team-scores', { client_id: uuid(), entry_id: team('Eagles').id, hole_id: st0.holes[0].id, gross_score: 5, is_no_return: false, base_revision: 1 })
  ok(afterClose.status === 422 && afterClose.body.outcome === 'round_closed', '6b closed round refuses scorer writes')
  const reopen = await api(ORG, '/api/team-entries/reopen-setup', { round_id: R18, reason: 'too late' }); ok(reopen.status === 409 || reopen.status === 422, `6c closed round cannot have its set-up reopened (${reopen.status} ${reopen.body.outcome})`)
  await agree(R18, 'closed round')
  const sums = (await sql(`select e.entry_name||'='||sum(s.gross_score)||'/'||count(*) from team_score_entries s join round_team_entries e on e.id=s.entry_id where e.round_id='${R18}' group by e.entry_name order by e.entry_name`)).split('\n')
  console.log('  DB totals:', sums.join('  '))
  const b = await mkPage(ORG, '18', 'board'); await b.page.getByText('Round 1').waitFor(); await b.page.waitForTimeout(800)
  const txt = await b.page.locator('section[aria-label="Team leaderboard"]').innerText()
  const exp = sums.map(s => { const [n, r] = s.split('='); const [t, c] = r.split('/'); return { n, t: +t, c: +c } }).sort((x, y) => x.t - y.t || x.n.localeCompare(y.n))
  ok(exp.every(x => x.c === 18), '6d every team has 18 holes in the database')
  for (const e of exp) ok(txt.includes(e.n) && txt.includes(String(e.t)), `6e leaderboard shows ${e.n} ${e.t}`)
  ok(exp.every((e, i) => i === 0 || txt.indexOf(exp[i - 1].n) < txt.indexOf(e.n)), '6f leaderboard order matches the database totals')
  ok(!/Group \d/.test(txt), '6g leaderboard shows team names, not playing-group names')
  ok(/Alex Ford|Daz Hill/.test(txt), '6h roster names appear under the team name')
  ok(exp[2].t === exp[3].t && (txt.match(/\bT3\b/g) || []).length === 2, '6i tied teams share T3, no countback invented')
  await b.page.screenshot({ path: 'shot_final_leaderboard.png', fullPage: true })

  // ---- 7. queue hygiene and HTTP health across every device ----
  console.log('7. queue + HTTP')
  for (const [k, p] of Object.entries({ ...pages, t4b })) {
    const q = JSON.parse((await (p.page ?? p).evaluate(() => localStorage.getItem('shim:teamScoreQueue'))) ?? '[]')
    const pend = q.filter(x => x.syncStatus === 'pending' || x.syncStatus === 'failed')
    ok(pend.length === 0, `7a device ${k}: nothing left unsent (${pend.length} pending, ${q.length} rows)`)
    ok(new Set(q.map(x => x.clientId)).size === q.length, `7b device ${k}: no duplicate queue rows`)
  }
  ok(badHttp.length === 0, `7c no 404/405/5xx on any app API call during the run ${JSON.stringify(badHttp.slice(0, 5))}`)

  const called = await (await fetch(BASE + '/api/e2e/called')).json()
  console.log('\nDatabase functions exercised:', called.map(([f, n]) => `${f} x${n}`).join(', '))
  console.log(`\nDEMO checks passed: ${pass}   failed: ${fails.length}`); if (fails.length) console.log(fails.join('\n'))
  await browser.close(); process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error('DEMO crashed:', e); process.exit(2) })
