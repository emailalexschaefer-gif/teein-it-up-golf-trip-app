// A tiny in-memory stand-in for the slice of the Supabase query builder the
// read routes use: from(t).select().eq()/neq()/in()/order().maybeSingle()
// and awaiting the builder. It records every query (when it started/ended)
// so tests can assert WHICH queries ran, in what order, and how many were
// in flight at once.

export type Row = Record<string, unknown>

// Timestamps use performance.now(): the route harness freezes Date.
export interface CallRecord {
  seq: number
  table: string
  filters: string[]
  startedAt: number
  endedAt: number
  /** how many queries were running when this one started (including itself) */
  concurrentAtStart: number
}

export type FailMode = 'error' | 'throw'

export interface FailRule {
  table: string
  mode: FailMode
  /** only fail queries whose recorded filters satisfy this (default: every query on the table) */
  when?: (filters: string[]) => boolean
}

export interface FakeDbOptions {
  tables: Record<string, Row[]>
  /** simulated round-trip time per query, in ms (0 = no delay) */
  latencyMs?: number
  /** make every query against a table fail */
  fail?: Record<string, FailMode>
  /** fail specific queries (by table and filters) */
  failRules?: FailRule[]
}

export class FakeDb {
  calls: CallRecord[] = []
  maxConcurrent = 0
  private running = 0
  private seq = 0
  storageSigned: string[] = []
  constructor(private opts: FakeDbOptions) {}

  from(table: string) {
    return new Query(this, table)
  }

  storage = {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, ttl: number) => {
        await this.delay()
        this.storageSigned.push(`${bucket}/${path}`)
        return { data: { signedUrl: `https://signed.example/${bucket}/${path}?ttl=${ttl}` }, error: null }
      },
    }),
  }

  get latency() { return this.opts.latencyMs ?? 0 }
  delay() { return this.latency > 0 ? new Promise<void>(r => setTimeout(r, this.latency)) : Promise.resolve() }

  /** @internal */
  async execute(table: string, filters: Array<[string, string, unknown]>, order: { col: string; asc: boolean } | null, single: boolean) {
    const rec: CallRecord = {
      seq: this.seq++, table, filters: filters.map(([op, c, v]) => `${op}:${c}=${JSON.stringify(v)}`),
      startedAt: performance.now(), endedAt: 0, concurrentAtStart: ++this.running,
    }
    this.maxConcurrent = Math.max(this.maxConcurrent, this.running)
    this.calls.push(rec)
    try {
      await this.delay()
      const mode = this.opts.fail?.[table]
        ?? this.opts.failRules?.find(r => r.table === table && (!r.when || r.when(rec.filters)))?.mode
      if (mode === 'throw') throw new Error(`network failure on ${table}`)
      if (mode === 'error') return { data: null, error: { message: `db error on ${table}` } }
      let rows = (this.opts.tables[table] ?? []).filter(r => filters.every(([op, col, val]) => {
        if (op === 'eq') return r[col] === val
        if (op === 'neq') return r[col] !== val
        if (op === 'in') return (val as unknown[]).includes(r[col])
        return true
      }))
      if (order) {
        const { col, asc } = order
        rows = [...rows].sort((a, b) => {
          const x = a[col] as number | string, y = b[col] as number | string
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
        })
      }
      return { data: single ? (rows[0] ?? null) : rows, error: null }
    } finally {
      rec.endedAt = performance.now()
      this.running--
    }
  }
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<[string, string, unknown]> = []
  private ord: { col: string; asc: boolean } | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() { return this }
  eq(col: string, val: unknown) { this.filters.push(['eq', col, val]); return this }
  neq(col: string, val: unknown) { this.filters.push(['neq', col, val]); return this }
  in(col: string, vals: unknown[]) { this.filters.push(['in', col, vals]); return this }
  order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this }
  limit() { return this }
  maybeSingle() { return this.db.execute(this.table, this.filters, this.ord, true) }
  single() { return this.db.execute(this.table, this.filters, this.ord, true) }
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.db.execute(this.table, this.filters, this.ord, false).then(onfulfilled, onrejected)
  }
}
