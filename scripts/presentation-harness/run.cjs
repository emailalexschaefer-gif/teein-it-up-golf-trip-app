const { chromium } = require('/opt/npm-tools/node_modules/playwright')
const fs = require('fs'), path = require('path')
const PUB = '/home/claude/work/presentation-v6/public'
const here = __dirname
const cases = ['photo-landscape','photo-portrait','photo-short','sg-photo','sg-photo-land','sg-nophoto','mb-card','mb-long','mb-divider','results-5','results-2','results-tied','cumulative-5','leaderboard-5','leaderboard-2','leaderboard-early-tied','champion']
const viewports = { '1366x768': [1366,768], '1920x1080': [1920,1080], 'mobile-landscape-844x390': [844,390] }
;(async () => {
  const browser = await chromium.launch()
  const results = []
  for (const [vn, [w,h]] of Object.entries(viewports)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.route('**/*', route => {
      const u = new URL(route.request().url())
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name=viewport content="width=device-width"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial}</style></head><body><div id=root></div><script src="/out.js"></script></body></html>' })
      if (u.pathname === '/out.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(here,'out.js')) })
      const f = path.join(PUB, u.pathname)
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.jpg') ? 'image/jpeg' : f.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' })
      return route.fulfill({ status: 404, body: '' })
    })
    for (const c of cases) {
      await page.goto('http://harness.test/#' + c); await page.reload()
      await page.waitForTimeout(1300)
      const m = await page.evaluate(() => {
        const stage = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).containerType === 'inline-size')
        const r = stage.getBoundingClientRect()
        const bad = []
        let minFont = 999
        stage.querySelectorAll('p,span').forEach(el => {
          if (!el.textContent.trim()) return
          const b = el.getBoundingClientRect(); if (!b.width) return
          const fs = parseFloat(getComputedStyle(el).fontSize); if (el.children.length === 0) minFont = Math.min(minFont, fs)
          // ellipsised text (nowrap) is allowed to clip; check geometry only
          if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) bad.push(el.textContent.trim().slice(0, 30))
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis') bad.push('ELLIPSIS:' + el.textContent.trim().slice(0, 30))
        })
        const card = document.querySelector('[data-testid=mb-card]'); let cardOverflow = false
        if (card) { const cb = card.getBoundingClientRect(); cardOverflow = card.scrollHeight > card.clientHeight + 1 || cb.top < r.top || cb.bottom > r.bottom }
        const callout = [...stage.querySelectorAll('p')].some(p => /EVENT MOMENTS|BLOOPERS/.test(p.textContent))
        const caption = document.querySelector('[data-testid=photo-caption]')
        return { stage: [Math.round(r.width), Math.round(r.height)], bad, minFont: Math.round(minFont*10)/10, cardOverflow, callout, hasCaption: !!caption }
      })
      await page.screenshot({ path: path.join(here, 'shots', `${vn}__${c}.png`) })
      results.push({ vn, c, ...m })
    }
    await ctx.close()
  }
  // music default OFF + manual toggle
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } }); const page = await ctx.newPage()
  await page.route('**/*', route => { const u = new URL(route.request().url())
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}</style></head><body><div id=root></div><script src="/out.js"></script></body></html>' })
    if (u.pathname === '/out.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(here,'out.js')) })
    const f = path.join(PUB, u.pathname); if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg' }); return route.fulfill({ status: 404, body: '' }) })
  await page.goto('http://harness.test/#results-5'); await page.reload(); await page.waitForTimeout(1500)
  const playsInitial = await page.evaluate(() => window.__plays)
  await page.mouse.click(683, 300); await page.waitForTimeout(400)
  const labelBefore = await page.getAttribute('button[aria-label*="music"]', 'aria-label')
  await page.click('button[aria-label*="music"]'); await page.waitForTimeout(800)
  const labelAfter = await page.getAttribute('button[aria-label*="music"]', 'aria-label'); const playsOn = await page.evaluate(() => window.__plays)
  await page.click('button[aria-label*="music"]'); await page.waitForTimeout(300)
  const labelOff = await page.getAttribute('button[aria-label*="music"]', 'aria-label')
  console.log(JSON.stringify({ music: { playsInitial, labelBefore, labelAfter, playsOn, labelOff } }))
  await ctx.close(); await browser.close()
  for (const r of results) console.log(JSON.stringify(r))
})()
