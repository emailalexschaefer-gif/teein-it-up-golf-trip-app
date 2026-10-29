// SCRATCH E2E: Chromium -> containers -> offline queue (shimmed Dexie) -> REAL route handlers -> REAL SQL functions in the scratch Postgres.
// Run: db_setup.sh; start server.ts; esbuild-bundle client.tsx; then `node run_e2e.js`.  Fixture data only. Not Supabase, not a device test.
const { chromium } = require('playwright')
const BASE = 'http://localhost:3999'
const ORG = 'a0000000-0000-0000-0000-000000000001'
const P = n => `b0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const R18 = '20000000-0000-0000-0000-000000000018', R9 = '20000000-0000-0000-0000-000000000009'
let pass = 0; const fails = []
const ok = (cond, name) => { if (cond) pass++; else { fails.push(name); console.log('  FAIL:', name) } }
const sql = async q => { const r = await fetch(BASE + '/api/e2e/sql', { method: 'POST', body: JSON.stringify({ sql: q }) }); const j = await r.json(); if (!r.ok) throw new Error(j.err); return j.out }
const api = async (uid, path, body, method = 'POST') => { const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: uid ? `uid=${uid}` : '' }, body: method === 'POST' ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }
const stateOf = async (uid, round) => (await api(uid, `/api/team-state?round_id=${round}`, null, 'GET')).body.state
const uuid = () => crypto.randomUUID()

;(async () => {
  const browser = await chromium.launch()
  const mkPage = async (uid, round, view, vp = { width: 390, height: 844 }) => {
    const ctx = await browser.newContext({ viewport: vp }); if (uid) await ctx.addCookies([{ name: 'uid', value: uid, url: BASE }])
    const page = await ctx.newPage(); page.on('pageerror', e => { fails.push('pageerror ' + e.message); console.log('  PAGEERROR', e.message) })
    await page.goto(`${BASE}/#${view}:${round}`); return { ctx, page }
  }
  const cell = (page, n) => page.locator(`[aria-label^="Hole ${n},"]`)
  const enter = async (page, n, gross, { sync = true } = {}) => {
    await cell(page, n).click(); await page.locator(`[aria-label="Score ${gross}"]`).click()
    try { await page.waitForFunction(([n, sync]) => { const e = document.querySelector(`[aria-label^="Hole ${n},"]`); const l = e?.getAttribute('aria-label') ?? ''; return sync ? /, scored$/.test(l) : /(offline saved|saving|scored)$/.test(l) }, [n, sync], { timeout: 15000 }) }
    catch (e) { console.log('  DEBUG queue:', await page.evaluate(() => localStorage.getItem('shim:teamScoreQueue'))); console.log('  DEBUG enter hole', n, 'labels:', await page.locator('[aria-label="Holes"] button').evaluateAll(b => b.map(x => x.getAttribute('aria-label')).slice(0, 8)), 'text:', (await page.locator('body').innerText()).slice(0, 600)); throw e }
  }

  // ---- A. organiser setup on the 18-hole round (UI) ----
  console.log('A. organiser setup')
  const org = await mkPage(ORG, '18', 'organiser'); const op = org.page
  await op.getByText('Choose the Ambrose format').waitFor()
  await op.getByRole('button', { name: 'Use this format' }).click()
  await op.getByText('Ambrose setup').waitFor()
  ok((await op.getByRole('button', { name: 'Start scoring' }).count()) === 0, 'A1 no Start scoring button exists (scoring is started from My HQ only)')
  for (let g = 1; g <= 4; g++) { await op.getByRole('button', { name: 'Save team' }).first().click(); await op.waitForFunction(g => document.querySelectorAll('select[id^=scorer-]').length === g, g, { timeout: 15000 }) }
  ok((await sql("select count(*) from round_team_entries where round_id='" + R18 + "'")) === '4', 'A2 four team entries saved')
  ok((await sql("select count(*) from round_team_members where round_id='" + R18 + "'")) === '16', 'A3 sixteen roster rows, four per team')
  ok(await op.getByText(/no confirmed scorer/).first().isVisible(), 'A4 blocker: scorers not confirmed')
  ok(await op.getByText(/Finish the steps above, then release and start the round from My HQ/).isVisible(), 'A5 hand-off says finish the steps first')
  for (let i = 0; i < 4; i++) { await op.locator('select[id^=scorer-]').nth(i).selectOption({ index: 1 }); await op.waitForTimeout(400) }
  await op.getByText(/Ready\. Release and start the round from My HQ/).waitFor({ timeout: 15000 })
  ok(true, 'A6 ready for release once all scorers confirmed')
  await op.screenshot({ path: 'shot_organiser_setup.png', fullPage: true })
  await sql("update rounds set status='active' where id='" + R18 + "'")
  const st0 = await stateOf(ORG, R18); const teamByName = n => st0.entries.find(e => e.entry_name === n)
  ok(st0.entries.every(e => e.scorer_confirmed_at), 'A8 scorer confirmed_at set by the database for every team')
  const scorerOf = n => teamByName(`Group ${n} team`).nominated_scorer_id
  ok([1, 2, 3, 4].every(n => scorerOf(n) === P((n - 1) * 4 + 1)), 'A9 each team scorer is its first listed member')

  // ---- B. team 1 (all 18; hole 3 = No Return), team 3 (drive tracking), plus two-device conflict for team 2 ----
  console.log('B. scoring, No Return, drives')
  const t1 = await mkPage(scorerOf(1), '18', 'scorer'); await t1.page.getByText('of 18 holes').waitFor()
  ok((await t1.page.locator('[aria-label="Holes"] button').count()) === 18, 'B1 eighteen holes in the strip')
  for (let h = 1; h <= 18; h++) { if (h === 3) { await cell(t1.page, 3).click(); await t1.page.getByRole('button', { name: /No Return/ }).click(); await t1.page.waitForFunction(() => /no return$/.test(document.querySelector('[aria-label^="Hole 3,"]').getAttribute('aria-label'))) } else await enter(t1.page, h, 4) }
  let st = await stateOf(ORG, R18); const rows1 = st.scores.filter(s => s.entry_id === teamByName('Group 1 team').id)
  ok(rows1.length === 18 && rows1.find(r => r.is_no_return)?.gross_score === null, 'B2 No Return stored with NO gross score (not invented)')
  ok(rows1.every(r => r.revision === 1), 'B3 first write of each hole is revision 1')
  await t1.page.screenshot({ path: 'shot_scorer.png', fullPage: true })

  const t3 = await mkPage(scorerOf(3), '18', 'scorer'); await t3.page.getByText('of 18 holes').waitFor()
  await cell(t3.page, 1).click()
  const driveSel = t3.page.locator('#drive'); ok(await driveSel.count() === 0, 'B4 no drive selector when drives are not tracked')
  for (let h = 1; h <= 18; h++) await enter(t3.page, h, h === 9 ? 5 : 4)

  // ---- C. offline + stale conflict (team 2, same scorer on a second device) ----
  console.log('C. offline conflict')
  const t2 = await mkPage(scorerOf(2), '18', 'scorer'); await t2.page.getByText('of 18 holes').waitFor()
  await enter(t2.page, 1, 4); await enter(t2.page, 2, 4)
  await t2.ctx.setOffline(true)
  await enter(t2.page, 3, 6, { sync: false })
  ok(/saved on this device|offline saved/i.test(await t2.page.locator('[aria-label^="Hole 3,"]').getAttribute('aria-label')), 'C1 offline score kept on the device')
  ok(await t2.page.getByText(/waiting to send/).isVisible(), 'C2 banner says it is waiting to send')
  const dev2 = await api(scorerOf(2), '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 2 team').id, hole_id: st0.holes[2].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(dev2.status === 200 && dev2.body.revision === 1, 'C3 second device writes hole 3 first (revision 1)')
  await t2.ctx.setOffline(false)
  await t2.page.getByText(/Someone changed this hole to 4/).first().waitFor({ timeout: 20000 })
  ok(true, 'C4 stale offline write became a visible conflict, not an overwrite')
  ok((await sql("select gross_score from team_score_entries where hole_id='" + st0.holes[2].id + "' and entry_id='" + teamByName('Group 2 team').id + "'")) === '4', 'C5 server value untouched by the stale write')
  await t2.page.screenshot({ path: 'shot_conflict.png', fullPage: true })
  await t2.page.getByRole('button', { name: 'Keep their score' }).click()
  await t2.page.waitForFunction(() => /, scored$/.test(document.querySelector('[aria-label^="Hole 3,"]').getAttribute('aria-label')), null, { timeout: 15000 })
  ok(true, 'C6 accepting the server score clears the conflict')
  for (let h = 4; h <= 18; h++) await enter(t2.page, h, 4)

  // ---- D. organiser lock vs offline scorer; scorer reassignment; expired auth ----
  console.log('D. lock, reassignment, expired auth')
  const t4 = await mkPage(scorerOf(4), '18', 'scorer'); await t4.page.getByText('of 18 holes').waitFor()
  for (let h = 1; h <= 4; h++) await enter(t4.page, h, 4)
  await t4.ctx.setOffline(true); await enter(t4.page, 5, 4, { sync: false })
  const ov = await api(ORG, '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 4 team').id, hole_id: st0.holes[4].id, gross_score: 3, is_no_return: false, base_revision: 0, reason: 'Rules ruling: drop taken' })
  ok(ov.status === 200 && ov.body.outcome === 'inserted', 'D1 organiser override accepted with a reason')
  const noReason = await api(ORG, '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 4 team').id, hole_id: st0.holes[5].id, gross_score: 3, is_no_return: false, base_revision: 0 })
  ok(noReason.status === 422 && noReason.body.outcome === 'reason_required', 'D2 organiser change without a reason is refused')
  await t4.ctx.setOffline(false)
  await t4.page.getByText(/The organiser has set this hole/).first().waitFor({ timeout: 20000 }); ok(true, 'D3 offline scorer sees the organiser lock')
  await t4.page.getByRole('button', { name: /Accept the organiser/ }).click()
  await t4.page.waitForFunction(() => /(locked)$/.test(document.querySelector('[aria-label^="Hole 5,"]').getAttribute('aria-label')), null, { timeout: 15000 }); ok(true, 'D4 scorer accepts; hole shows organiser-set')
  const rel = await api(ORG, '/api/team-scores/unlock', { entry_id: teamByName('Group 4 team').id, hole_id: st0.holes[4].id, reason: 'Ruling confirmed, scorer may continue' })
  ok(rel.status === 200 && rel.body.outcome === 'released', 'D5 organiser releases the lock (audited)')
  ok((await sql("select count(*) from team_entry_audit where entry_id='" + teamByName('Group 4 team').id + "' and action='override_lock_released'")) === '1', 'D6 audit row written for the release')
  // reassignment: organiser nominates Group 4's second player; old scorer is refused by the database
  const re = await api(ORG, '/api/team-entries/scorer', { entry_id: teamByName('Group 4 team').id, scorer_id: P(14) })
  ok(re.status === 200, 'D7 organiser reassigns the scorer')
  const old = await api(scorerOf(4), '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 4 team').id, hole_id: st0.holes[5].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(old.status === 403 && old.body.outcome === 'not_authorised', 'D8 old scorer refused after reassignment (database decides)')
  const neu = await api(P(14), '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 4 team').id, hole_id: st0.holes[5].id, gross_score: 4, is_no_return: false, base_revision: 0 })
  ok(neu.status === 200, 'D9 new scorer accepted')
  await t4.page.reload(); await t4.page.getByText(/Only the team’s nominated scorer/).waitFor({ timeout: 15000 }); ok(true, 'D10 old scorer screen now read-only with an explanation')
  // new scorer finishes team 4 in the UI
  const t4b = await mkPage(P(14), '18', 'scorer'); await t4b.page.getByText('of 18 holes').waitFor()
  for (let h = 7; h <= 18; h++) await enter(t4b.page, h, 4)
  await enter(t4b.page, 6, 4).catch(() => {})
  // expired auth in the UI: signed out mid-round -> score kept on the device with a clear message; signing back in sends it
  await t4b.ctx.clearCookies()
  await enter(t4b.page, 1, 5, { sync: false })
  await t4b.page.getByText(/Signed out of Teein’ It Up/).first().waitFor({ timeout: 20000 }); ok(true, 'D10b signed-out scorer sees a sign-in message')
  ok(/offline saved|saving/.test(await t4b.page.locator('[aria-label^="Hole 1,"]').getAttribute('aria-label')), 'D10c score kept on the device while signed out')
  await t4b.ctx.addCookies([{ name: 'uid', value: P(14), url: BASE }])
  await t4b.page.waitForFunction(() => /, scored$/.test(document.querySelector('[aria-label^="Hole 1,"]').getAttribute('aria-label')), null, { timeout: 25000 }); ok(true, 'D10d after signing back in the kept score is sent automatically')
  ok((await sql("select gross_score from team_score_entries where entry_id='" + teamByName('Group 4 team').id + "' and hole_id='" + st0.holes[0].id + "'")) === '5', 'D10e server holds the score sent after re-authentication')
  // expired auth: cookie removed -> 401 -> kept on device; restored -> sent
  const t5 = t3; await t5.ctx.clearCookies()
  const unauth = await api(null, '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 3 team').id, hole_id: st0.holes[0].id, gross_score: 4, is_no_return: false, base_revision: 1 })
  ok(unauth.status === 401, 'D11 signed-out API call is a JSON 401, not a redirect/405')
  const get405 = await api(ORG, '/api/team-scores', null, 'GET'); ok(get405.status === 405, 'D12 GET on a POST-only route answers 405 (client never does this)')

  // ---- E. queries (flags) and No Return resolution by the organiser UI ----
  console.log('E. flags and organiser tools')
  await t3.ctx.addCookies([{ name: 'uid', value: P(10), url: BASE }]); await t3.page.reload(); await t3.page.getByText('of 18 holes').waitFor({ timeout: 15000 })
  ok(await t3.page.getByText(/Only the team’s nominated scorer/).isVisible(), 'E1 non-scorer team member sees read-only scorecard')
  await t3.page.getByRole('button', { name: 'Query this score' }).click(); await t3.page.getByText('Query raised.').waitFor({ timeout: 15000 }); ok(true, 'E2 team member raised a query')
  ok((await sql("select count(*) from team_score_flags where entry_id='" + teamByName('Group 3 team').id + "' and status='open'")) === '1', 'E3 open flag stored')
  let b = await mkPage(ORG, '18', 'board'); await b.page.getByText('Not yet ranked').waitFor({ timeout: 15000 })
  ok(await b.page.getByText(/1 open score query/).isVisible(), 'E4 team with an open query is not ranked')
  const op2 = await mkPage(ORG, '18', 'organiser'); await op2.page.getByText('Organiser tools').waitFor({ timeout: 15000 })
  await op2.page.locator('#org-team').selectOption({ label: 'Group 1 team' })
  await op2.page.getByText(/Hole 3: No Return, waiting for you/).waitFor(); ok(true, 'E5 organiser sees the unresolved No Return')
  await op2.page.getByRole('button', { name: 'Record No Score' }).click(); await op2.page.getByText('Give a reason first').waitFor(); ok(true, 'E6 reason required in the UI')
  await op2.page.getByLabel('Reason').fill('Team picked up; no score taken'); await op2.page.getByRole('button', { name: 'Record No Score' }).click()
  await op2.page.getByText('Hole 3 recorded as No Score.').waitFor({ timeout: 15000 }); ok(true, 'E7 No Return resolved as No Score')
  b = await mkPage(ORG, '18', 'board'); await b.page.getByText('Not yet ranked').waitFor({ timeout: 15000 })
  ok(await b.page.getByText(/recorded as No Score/).isVisible(), 'E8 team stays Unranked after No Score')
  await op2.page.getByLabel('Hole').selectOption({ label: 'Hole 3' }); await op2.page.getByLabel('New score').fill('5'); await op2.page.getByLabel('Reason').fill('Marker confirmed 5 after review')
  await op2.page.getByRole('button', { name: 'Set score' }).click(); await op2.page.getByText(/Hole 3 set to 5/).waitFor({ timeout: 15000 }); ok(true, 'E9 organiser applied a reasoned explicit score')
  const flag = (await stateOf(ORG, R18)).flags[0]
  await op2.page.reload(); await op2.page.getByText('Organiser tools').waitFor(); await op2.page.locator('#org-team').selectOption({ label: 'Group 3 team' })
  await op2.page.getByText(/Query on hole/).waitFor(); await op2.page.getByLabel('Reason').fill('Checked with the team: score stands')
  await op2.page.getByRole('button', { name: 'Resolve' }).click(); await op2.page.getByText('Query resolved.').waitFor({ timeout: 15000 }); ok(true, 'E10 organiser resolved the query')
  ok(!!flag, 'E11 flag row existed')

  // ---- F. close the round; leaderboard consistency ----
  console.log('F. close + leaderboard')
  const late = await api(scorerOf(1), '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 1 team').id, hole_id: st0.holes[0].id, gross_score: 4, is_no_return: false, base_revision: 1 })
  ok(late.status === 200, 'F0 before closing the same scorer can still edit')
  await sql("update rounds set status='completed' where id='" + R18 + "'")
  const closed = await api(scorerOf(1), '/api/team-scores', { client_id: uuid(), entry_id: teamByName('Group 1 team').id, hole_id: st0.holes[0].id, gross_score: 5, is_no_return: false, base_revision: 2 })
  ok(closed.status === 422 && closed.body.outcome === 'round_closed', 'F1 closed round refuses scorer writes')
  const sums = (await sql("select e.entry_name||'='||sum(s.gross_score)||'/'||count(*) from team_score_entries s join round_team_entries e on e.id=s.entry_id where e.round_id='" + R18 + "' group by e.entry_name order by 1")).split('\n')
  console.log('  DB totals:', sums.join('  '))
  b = await mkPage(ORG, '18', 'board'); await b.page.getByText('Round 1').waitFor(); await b.page.waitForTimeout(800)
  const txt = await b.page.locator('section[aria-label="Team leaderboard"]').innerText()
  const exp = sums.map(s => { const [n, r] = s.split('='); const [t, c] = r.split('/'); return { n, t: +t, c: +c } }).filter(x => x.c === 18).sort((a, b) => a.t - b.t || a.n.localeCompare(b.n))
  for (const e of exp) ok(txt.includes(e.n) && txt.includes(String(e.t)), `F2 leaderboard shows ${e.n} ${e.t}`)
  ok(exp.length === 4 || /Not yet ranked/.test(txt), 'F3 every team accounted for (ranked or listed as unranked)')
  const pos = n => txt.indexOf(n)
  ok(exp.length === 4 && pos(exp[0].n) < pos(exp[1].n) && pos(exp[1].n) < pos(exp[2].n), 'F3b leaderboard order matches the database totals (lowest gross first)')
  ok(exp.length === 4 && exp[2].t === exp[3].t ? (txt.match(/\bT3\b/g) || []).length === 2 : true, 'F3c tied teams share a position (T3, T3), no countback invented')
  await b.page.screenshot({ path: 'shot_leaderboard.png', fullPage: true })
  ok(!/\bnet\b.*\d+\.\d/i.test(txt), 'F4 no net figures shown')

  // ---- G. nine-hole round with optional drive tracking + organiser waiver ----
  console.log('G. nine holes + drives')
  const o9 = await mkPage(ORG, '9', 'organiser'); await o9.page.getByText('Choose the Ambrose format').waitFor()
  await o9.page.getByLabel(/Minimum drives per player/).fill('2')
  await o9.page.getByRole('button', { name: 'Use this format' }).click(); await o9.page.getByText('Ambrose setup').waitFor()
  await o9.page.getByRole('button', { name: 'Save team' }).first().click(); await o9.page.waitForFunction(() => document.querySelectorAll('select[id^=scorer-]').length === 1, null, { timeout: 15000 })
  await o9.page.locator('select[id^=scorer-]').first().selectOption({ label: 'Alex Ford' }); await o9.page.waitForTimeout(500)
  await sql("update rounds set status='active' where id='" + R9 + "'")
  const n9 = await mkPage(P(1), '9', 'scorer'); await n9.page.getByText('of 9 holes').waitFor()
  ok((await n9.page.locator('[aria-label="Holes"] button').count()) === 9, 'G1 nine holes in the strip (not eighteen)')
  ok(await n9.page.locator('#drive').count() === 1, 'G1b drive selector appears when a minimum is configured')
  for (let h = 1; h <= 9; h++) { await cell(n9.page, h).click(); await n9.page.locator('#drive').selectOption({ index: h <= 5 ? 1 : 2 }); await n9.page.locator('[aria-label="Score 4"]').click()
    await n9.page.waitForFunction(h => /, scored$/.test(document.querySelector(`[aria-label^="Hole ${h},"]`).getAttribute('aria-label')), h, { timeout: 15000 }) }
  ok(await n9.page.getByText('9 of 9 holes').isVisible(), 'G2 progress reads 9 of 9')
  ok((await sql("select count(*) from team_score_entries where drive_player_id is not null and entry_id in (select id from round_team_entries where round_id='" + R9 + "')")) === '9', 'G2b selected drive stored on every hole')
  let b9 = await mkPage(ORG, '9', 'board'); await b9.page.getByText('Nine-hole round').waitFor(); await b9.page.waitForTimeout(800)
  ok(/minimum drives not met by 2 players/.test(await b9.page.locator('section[aria-label="Team leaderboard"]').innerText()), 'G3 drive shortfall keeps the team unranked')
  const ag1 = await (await fetch(BASE + '/api/e2e/agree?round=' + R9)).json(); ok(ag1.every(v => Array.isArray(v.mismatch) && v.mismatch.length === 0 && v.complete === false), 'G3b drive shortfall: app and database both say NOT complete')
  const o9b = await mkPage(ORG, '9', 'organiser'); await o9b.page.getByText('Organiser tools').waitFor({ timeout: 15000 })
  await o9b.page.getByText(/Minimum drives not met by/).waitFor(); await o9b.page.getByLabel('Reason').fill('Short-handed morning; minimum waived by organiser')
  await o9b.page.getByRole('button', { name: 'Waive' }).click(); await o9b.page.getByText('Drive requirement waived.').waitFor({ timeout: 15000 }); ok(true, 'G4 organiser waived the requirement with a reason')
  b9 = await mkPage(ORG, '9', 'board'); await b9.page.getByText('Nine-hole round').waitFor(); await b9.page.waitForTimeout(800)
  ok(/36/.test(await b9.page.locator('section[aria-label="Team leaderboard"]').innerText()), 'G5 after the waiver the nine-hole team ranks on 36 (no 18-hole requirement)')

  const ag2 = await (await fetch(BASE + '/api/e2e/agree?round=' + R9)).json(); ok(ag2.every(v => Array.isArray(v.mismatch) && v.mismatch.length === 0 && v.complete === true), 'G6 after the waiver: app and database both say complete')
  await sql("update rounds set status='cancelled' where id='" + R9 + "'")
  const ag3 = await (await fetch(BASE + '/api/e2e/agree?round=' + R9)).json(); ok(ag3.every(v => Array.isArray(v.mismatch) && v.mismatch.length === 0), 'G7 cancelled round: app and database still agree')
  const cw = await api(P(1), '/api/team-scores', { client_id: uuid(), entry_id: ((await stateOf(ORG, R9)).entries[0].id), hole_id: (await stateOf(ORG, R9)).holes[0].id, gross_score: 5, is_no_return: false, base_revision: 1 }); ok(cw.status === 422 && cw.body.outcome === 'round_closed', 'G8 cancelled round refuses scorer writes')

  const called = await (await fetch(BASE + '/api/e2e/called')).json()
  console.log('\nDatabase functions exercised:', called.map(([f, n]) => `${f} x${n}`).join(', '))
  console.log(`\nE2E checks passed: ${pass}   failed: ${fails.length}`); if (fails.length) console.log(fails.join('\n'))
  await browser.close(); process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error('E2E crashed:', e); process.exit(2) })
