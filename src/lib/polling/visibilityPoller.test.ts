import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisibilityPoller, type PollerEnv } from './visibilityPoller'

// Deterministic fake clock + visibility.
function makeEnv() {
  let visible = true
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const subs = new Set<() => void>()
  const env: PollerEnv = {
    isVisible: () => visible,
    onVisibilityChange: (cb) => { subs.add(cb); return () => subs.delete(cb) },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimer: (h) => { timers.delete(h as number) },
  }
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  return {
    env,
    pending: () => timers.size,
    setVisible: async (v: boolean) => { visible = v; subs.forEach(cb => cb()); await flush() },
    advance: async (ms: number) => {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush()
      }
      now = target
    },
    subscribers: () => subs.size,
  }
}

test('polls on the interval while visible', async () => {
  const e = makeEnv(); let n = 0
  createVisibilityPoller(() => { n++ }, 8000, e.env)
  await e.advance(7999); assert.equal(n, 0)
  await e.advance(1); assert.equal(n, 1)
  await e.advance(16000); assert.equal(n, 3)
})
test('while hidden there is no pending timer and no request, however long it stays hidden', async () => {
  const e = makeEnv(); let n = 0
  createVisibilityPoller(() => { n++ }, 8000, e.env)
  await e.setVisible(false)
  assert.equal(e.pending(), 0)
  await e.advance(10 * 60_000)
  assert.equal(n, 0)
})
test('returning to the page refreshes immediately, then resumes the normal cadence', async () => {
  const e = makeEnv(); let n = 0
  createVisibilityPoller(() => { n++ }, 8000, e.env)
  await e.setVisible(false); await e.advance(60_000)
  await e.setVisible(true)
  assert.equal(n, 1, 'immediate refresh on return')
  await e.advance(7999); assert.equal(n, 1)
  await e.advance(1); assert.equal(n, 2)
})
test('never overlaps: a slow request delays the next tick instead of stacking', async () => {
  const e = makeEnv(); let started = 0, active = 0, maxActive = 0
  let release: () => void = () => {}
  createVisibilityPoller(() => { started++; active++; maxActive = Math.max(maxActive, active); return new Promise<void>(r => { release = () => { active--; r() } }) }, 1000, e.env)
  await e.advance(1000); assert.equal(started, 1)
  await e.advance(30_000); assert.equal(started, 1, 'no new request while one is in flight')
  release(); await Promise.resolve(); await Promise.resolve(); await e.advance(0)
  await e.advance(1000); assert.equal(started, 2)
  assert.equal(maxActive, 1)
})
test('resuming while a request is in flight queues exactly one follow-up (not many)', async () => {
  const e = makeEnv(); let started = 0
  let release: () => void = () => {}
  createVisibilityPoller(() => { started++; return new Promise<void>(r => { release = r }) }, 1000, e.env)
  await e.advance(1000); assert.equal(started, 1)
  await e.setVisible(false); await e.setVisible(true); await e.setVisible(false); await e.setVisible(true)
  assert.equal(started, 1)
  release(); await e.advance(0); await e.advance(0)
  assert.equal(started, 2)
})
test('a failing task does not stop the polling', async () => {
  const e = makeEnv(); let n = 0
  createVisibilityPoller(() => { n++; throw new Error('boom') }, 1000, e.env)
  await e.advance(3000); assert.equal(n, 3)
})
test('stop() cancels timers and listeners; an in-flight run finishing later schedules nothing', async () => {
  const e = makeEnv(); let n = 0
  let release: () => void = () => {}
  const p = createVisibilityPoller(() => { n++; return new Promise<void>(r => { release = r }) }, 1000, e.env)
  await e.advance(1000)
  p.stop()
  assert.equal(e.subscribers(), 0)
  release(); await e.advance(0)
  assert.equal(e.pending(), 0)
  await e.advance(10_000); assert.equal(n, 1)
  await e.setVisible(false); await e.setVisible(true); assert.equal(n, 1)
})
test('starting while hidden schedules nothing until the page is shown', async () => {
  const e = makeEnv(); let n = 0
  await e.setVisible(false)
  createVisibilityPoller(() => { n++ }, 1000, e.env)
  assert.equal(e.pending(), 0)
  await e.setVisible(true); assert.equal(n, 1)
})
test('refreshNow runs once immediately without creating a second timer chain', async () => {
  const e = makeEnv(); let n = 0
  const p = createVisibilityPoller(() => { n++ }, 1000, e.env)
  p.refreshNow(); await e.advance(0); assert.equal(n, 1)
  assert.equal(e.pending(), 1)
})
