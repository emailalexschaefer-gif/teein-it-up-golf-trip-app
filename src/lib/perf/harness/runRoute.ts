import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { FakeDb, type FakeDbOptions } from './fakeDb'
import { setHarness } from './state'

// Fixed clock so the one `new Date()` fallback in the tournament route is
// deterministic in goldens.
export const FIXED_NOW = Date.parse('2026-10-20T03:00:00.000Z')

// The routes are loaded through tsx's CommonJS path, so the three
// framework/infra imports a route handler has (`next/server` and the two
// Supabase client factories) are redirected to tiny in-repo stubs by
// wrapping Module._resolveFilename. Everything else — the route's own logic
// and the pure libs it imports — loads untouched.
const stubPath = (name: string) => fileURLToPath(new URL(`./stubs/${name}`, import.meta.url))
const STUBS: Record<string, string> = {
  'next/server': stubPath('nextServer.ts'),
  '@/lib/supabase/server': stubPath('supabaseServer.ts'),
  '@/lib/supabase/admin': stubPath('supabaseAdmin.ts'),
}

let registered = false
function ensureHooks() {
  if (registered) return
  const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
  const original = M._resolveFilename
  M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    const hit = STUBS[request]
    if (hit) return hit
    return original.call(this, request, ...rest)
  }
  registered = true
}

export interface RunOptions extends FakeDbOptions {
  /** the signed-in user (null = not signed in) */
  user: { id: string } | null
}

export interface RunResult {
  status: number
  body: unknown
  db: FakeDb
  elapsedMs: number
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

const moduleCache = new Map<string, Handler>()

export async function loadGet(absolutePath: string): Promise<Handler> {
  ensureHooks()
  const cached = moduleCache.get(absolutePath)
  if (cached) return cached
  const mod = await import(absolutePath) as { GET: Handler }
  moduleCache.set(absolutePath, mod.GET)
  return mod.GET
}

export async function runGet(absolutePath: string, params: Record<string, string>, opts: RunOptions): Promise<RunResult> {
  const GET = await loadGet(absolutePath)
  const db = new FakeDb(opts)
  setHarness({
    admin: db,
    sessionClient: () => ({
      auth: { getUser: async () => ({ data: { user: opts.user }, error: null }) },
      storage: db.storage,
      from: (t: string) => db.from(t),
    }),
  })
  const g = globalThis as unknown as { Date: unknown }
  const RealDate = g.Date as DateConstructor
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FIXED_NOW)
      else super(...(args as [number]))
    }
    static now() { return FIXED_NOW }
  }
  const silence = { error: console.error, warn: console.warn, log: console.log }
  console.error = () => {}; console.warn = () => {}; console.log = () => {}
  const t0 = RealDate.now()
  try {
    g.Date = FixedDate
    let res: Response
    try {
      res = await GET(new Request('http://localhost/test'), { params: Promise.resolve(params) })
    } catch (err) {
      // A route with no catch of its own lets the error escape (Next turns that into a 500).
      g.Date = RealDate
      return { status: -1, body: { threw: err instanceof Error ? err.message : String(err) }, db, elapsedMs: RealDate.now() - t0 }
    }
    g.Date = RealDate
    const elapsedMs = RealDate.now() - t0
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, db, elapsedMs }
  } finally {
    g.Date = RealDate
    console.error = silence.error; console.warn = silence.warn; console.log = silence.log
  }
}
