// SCRATCH E2E: two-person Ambrose. One playing group of four holds TWO competition teams (slots 1+2 and 3+4); teams, groups and entries stay distinct.
const { chromium } = require('playwright')
const BASE = 'http://localhost:3999', ORG = 'a0000000-0000-0000-0000-000000000001', R2 = '20000000-0000-0000-0000-000000000002'
const P = n => `b0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
let pass = 0; const fails = []; const ok = (c, n) => { if (c) pass++; else { fails.push(n); console.log('  FAIL:', n) } }
const sql = async q => { const r = await fetch(BASE + '/api/e2e/sql', { method: 'POST', body: JSON.stringify({ sql: q }) }); const j = await r.json(); if (!r.ok) throw new Error(j.err); return j.out }
;(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addCookies([{ name: 'uid', value: ORG, url: BASE }])
  const page = await ctx.newPage(); page.on('pageerror', e => { fails.push('pageerror ' + e.message) })
  await page.goto(`${BASE}/#hq:2`)
  await page.getByRole('button', { name: /Set up Ambrose for/ }).click()
  await page.getByRole('radio', { name: 'Two-person' }).click(); await page.getByRole('button', { name: 'Use this format' }).click(); await page.getByText('Ambrose setup').waitFor()
  ok((await sql(`select format||'/'||team_size||'/'||handicap_method from round_competition_config where round_id='${R2}'`)) === 'ambrose_2/2/gross_only', 'T1 two-person, gross_only')
  await page.getByRole('button', { name: 'Save team' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('select[id^=scorer-]').length === 2, null, { timeout: 15000 })
  ok((await sql(`select count(*)||'/'||count(distinct group_id) from round_team_entries where round_id='${R2}'`)) === '2/1', 'T2 one playing group holds two separate teams (2 entries, 1 group)')
  ok((await sql(`select string_agg(distinct entry_name, ',' order by entry_name) from round_team_entries where round_id='${R2}'`)).split(',').length === 2, 'T3 the two teams have different names')
  const mem = await sql(`select string_agg(e.entry_name || ':' || m.player_id::text, ' ' order by e.entry_name, m.position) from round_team_members m join round_team_entries e on e.id=m.entry_id where m.round_id='${R2}'`)
  ok([1, 2, 3, 4].every(n => mem.includes(P(n))), 'T4 all four group players are on a team')
  ok((await sql(`select count(*) from (select entry_id from round_team_members where round_id='${R2}' group by entry_id having count(*)=2) x`)) === '2', 'T5 each team has exactly two players')
  const wrong = await fetch(BASE + '/api/team-entries/roster', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'uid=' + ORG }, body: JSON.stringify({ round_id: R2, team_id: (await sql(`select team_id from round_team_entries where round_id='${R2}' limit 1`)), member_ids: [P(1), P(2), P(3)] }) })
  ok(wrong.status === 422, 'T6 a three-player team is refused in two-person Ambrose')
  console.log(`\nTWO-PERSON checks passed: ${pass}   failed: ${fails.length}`); if (fails.length) console.log(fails.join('\n'))
  await browser.close(); process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error('crashed:', e); process.exit(2) })
