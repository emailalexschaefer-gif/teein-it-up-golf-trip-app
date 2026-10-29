// HARNESS ONLY. The real Dexie package could not be installed in the sandbox (no npm route), so this stands in for it: just the methods the team queue uses,
// persisted to localStorage so a page reload keeps queued rows. It does NOT test Dexie or IndexedDB themselves.
type Row = Record<string, unknown>
export type Table<T = Row, K = string> = TableImpl<T, K>
class Query<T> {
  constructor(private rows: () => T[], private pred: (r: T) => boolean) {}
  filter(f: (r: T) => boolean) { const p = this.pred; return new Query(this.rows, r => p(r) && f(r)) }
  async toArray() { return this.rows().filter(this.pred) }
}
class TableImpl<T = Row, K = string> {
  private pk = 'id'
  constructor(public name: string) {}
  setKey(k: string) { this.pk = k }
  private load(): T[] { try { return JSON.parse(localStorage.getItem('shim:' + this.name) ?? '[]') } catch { return [] } }
  private save(rows: T[]) { localStorage.setItem('shim:' + this.name, JSON.stringify(rows)) }
  async toArray() { return this.load() }
  async get(k: K) { return this.load().find(r => (r as Row)[this.pk] === k) }
  async put(row: T) { const rows = this.load().filter(r => (r as Row)[this.pk] !== (row as Row)[this.pk]); rows.push(row); this.save(rows); return (row as Row)[this.pk] as K }
  async update(k: K, patch: Partial<T>) { const rows = this.load(); const i = rows.findIndex(r => (r as Row)[this.pk] === k); if (i < 0) return 0; rows[i] = { ...rows[i], ...patch }; this.save(rows); return 1 }
  async delete(k: K) { this.save(this.load().filter(r => (r as Row)[this.pk] !== k)) }
  where(field: string) { return { equals: (v: unknown) => new Query<T>(() => this.load(), r => (r as Row)[field] === v) } }
}
export default class Dexie {
  version(_n: number) { return { stores: (s: Record<string, string>) => { for (const [name, spec] of Object.entries(s)) { const t = ((this as unknown as Row)[name] as TableImpl) ?? new TableImpl(name); t.setKey(spec.split(',')[0].replace(/[&+*]/g, '').trim() || 'id'); (this as unknown as Row)[name] = t } const v = { upgrade: (_f: unknown) => v }; return v } } }
  async transaction(_mode: string, ...args: unknown[]) { return (args[args.length - 1] as () => Promise<unknown>)() }
}
