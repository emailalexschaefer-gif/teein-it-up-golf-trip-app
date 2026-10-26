// Package 3 -- Priority 3: the presentation never requests browser fullscreen by itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) && out.push(p) }
  return out
}
const player = readFileSync(join(SRC, 'components/memories/EventHighlightsPlayer.tsx'), 'utf8')
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('34-37: the only requestFullscreen call in the whole app is inside the tap-driven toggle', () => {
  const hits = walk(SRC).filter(f => /requestFullscreen/.test(stripComments(readFileSync(f, 'utf8'))))
  assert.deepEqual(hits.map(f => f.slice(SRC.length + 1)), ['components/memories/EventHighlightsPlayer.tsx'])
  const code = stripComments(player)
  assert.equal((code.match(/requestFullscreen/g) ?? []).length, 1)
  const fn = code.slice(code.indexOf('function toggleFullscreen'))
  assert.ok(fn.indexOf('requestFullscreen') > -1 && fn.indexOf('requestFullscreen') < 400, 'inside toggleFullscreen')
})
test('the toggle is only reachable from the button onClick (no effect, timer, slide change or autoplay calls it)', () => {
  const code = stripComments(player)
  const calls = code.match(/(?<!function )toggleFullscreen\(\)/g) ?? []
  assert.equal(calls.length, 1)
  assert.match(code, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); toggleFullscreen\(\) \}\}/)
})
test('38: the optional button remains, inside the tap-to-reveal controls', () => {
  assert.match(player, /aria-label=\{isFullscreen \? 'Exit full screen' : 'Enter full screen'\}/)
})
test('orientation lock is only attempted while already fullscreen (never as a side effect of opening)', () => {
  const code = stripComments(player)
  assert.match(code, /document\.fullscreenElement && orientation && typeof orientation\.lock === 'function'/)
  assert.match(code, /if \(on && orientation && typeof orientation\.lock === 'function'\)/)
})
test('portrait still gets the rotate hint', () => { assert.match(player, /setShowRotateHint\(stillPortrait\)/) })
test('clapping-hands control is labelled: it toggles applause on winner/champion slides', () => {
  assert.match(player, /'Turn celebration sound off' : 'Turn celebration sound on'/)
  assert.match(player, /Applause on winner slides: ON \(tap to turn off\)/)
  assert.match(player, /Applause on winner slides: OFF \(tap to turn on\)/)
})
