// Release 3 / Package 3A — a small polling helper for the few screens that
// run their own timer instead of react-query (which already pauses hidden
// tabs). It guarantees:
//   - no polling while the page is hidden (no timer is pending at all)
//   - an immediate refresh when the page becomes visible again
//   - never two overlapping requests: the next tick is scheduled only AFTER
//     the previous one settles; a resume while one is in flight queues exactly
//     one follow-up refresh
//   - stop() cancels everything, and an in-flight run that finishes after
//     stop() schedules nothing
// It is deliberately NOT used for offline score sync (lib/db/sync.ts) or any
// score-write path.

export interface PollerEnv {
  isVisible: () => boolean
  /** subscribe to visibility changes; returns an unsubscribe function */
  onVisibilityChange: (cb: () => void) => () => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export interface VisibilityPoller { stop: () => void; refreshNow: () => void }

export function createVisibilityPoller(
  task: () => Promise<unknown> | unknown,
  intervalMs: number,
  env: PollerEnv,
): VisibilityPoller {
  let stopped = false
  let inFlight = false
  let rerun = false
  let timer: unknown = null

  const clear = () => { if (timer !== null) { env.clearTimer(timer); timer = null } }
  const schedule = () => {
    clear()
    if (stopped || !env.isVisible()) return
    timer = env.setTimer(() => { timer = null; void run() }, intervalMs)
  }
  async function run() {
    if (stopped) return
    if (inFlight) { rerun = true; return }
    inFlight = true
    try { await task() } catch { /* a failed background refresh is retried on the next tick */ }
    inFlight = false
    if (stopped) return
    if (rerun) { rerun = false; if (env.isVisible()) { void run(); return } }
    schedule()
  }

  const unsubscribe = env.onVisibilityChange(() => {
    if (stopped) return
    if (env.isVisible()) { clear(); void run() } // back on screen: refresh now, then resume cadence
    else clear()                                  // hidden: nothing pending
  })

  schedule()

  return {
    refreshNow: () => { if (!stopped) { clear(); void run() } },
    stop: () => { stopped = true; clear(); unsubscribe() },
  }
}

/**
 * Browser wiring. The caller keeps doing its own first load; this only
 * drives the repeating refresh. Returns a stop function for effect cleanup.
 */
export function startVisibilityPolling(task: () => Promise<unknown> | unknown, intervalMs: number): () => void {
  if (typeof document === 'undefined') return () => {}
  const poller = createVisibilityPoller(task, intervalMs, {
    isVisible: () => document.visibilityState !== 'hidden',
    onVisibilityChange: (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  })
  return poller.stop
}
