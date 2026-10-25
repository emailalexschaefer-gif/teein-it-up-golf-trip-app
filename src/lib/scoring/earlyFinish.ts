/**
 * Package 3: Finish Round Early -- the app-side view of the frozen official results.
 *
 * The database (migration 100) is the only place that decides WHICH nine holes qualify
 * (round_official_snapshot): this module never recomputes a segment or a point. It only
 *   * reads the finish-early decision + frozen per-player results (tolerant: any error or a
 *     missing migration means "every round is a normal round", i.e. today's behaviour), and
 *   * adapts per-round results before they reach the existing, unmodified
 *     computeCumulativeStandings / determineRoundWinners (adjustForEarlyFinish).
 *
 * Rules enforced here (approved product rules):
 *   - a finished-early round is EXCLUDED from the event championship unless the organiser
 *     explicitly included it (rounds.counts_toward_event);
 *   - when included, only QUALIFYING players contribute, using their OFFICIAL nine-hole points;
 *   - a player who is INCOMPLETE in an included round is not ranked at all ("Not ranked --
 *     incomplete round"): they keep their actual points in a separate list and are never turned
 *     into a zero or ranked as if they had finished;
 *   - an excluded round contributes nothing to the championship but every score stays visible.
 */
import type { RoundPlayerResult } from '@/lib/scoring/multiRound'

export type EarlyReason = 'weather' | 'safety' | 'other'
export const EARLY_REASON_LABEL: Record<EarlyReason, string> = { weather: 'Weather', safety: 'Safety', other: 'Other' }
export const EARLY_REASONS: { value: EarlyReason; label: string }[] = [
  { value: 'weather', label: 'Weather / course conditions' },
  { value: 'safety', label: 'Safety / emergency' },
  { value: 'other', label: 'Other' },
]
export const EARLY_NOTE_MAX = 200

export interface EarlyPlayerResult {
  playerId: string
  kind: 'qualifying' | 'incomplete'
  /** NULL for incomplete. 0 only for a genuine qualifying zero. */
  officialPoints: number | null
  /** The nine per-hole points in the player's playing order (qualifying only). */
  segmentPoints: number[] | null
  segmentHoles: number[] | null
  actualPoints: number
  holesPlayed: number
  startHole: number
}

export interface EarlyRoundInfo {
  roundId: string
  reason: EarlyReason
  note: string | null
  officialHoles: number | null
  countsTowardEvent: boolean
  results: Map<string, EarlyPlayerResult>
}

export function normaliseEarlyReason(v: unknown): EarlyReason | null {
  return v === 'weather' || v === 'safety' || v === 'other' ? v : null
}
export function normaliseEarlyNote(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, EARLY_NOTE_MAX) : null
}

const toNums = (v: unknown): number[] | null => (Array.isArray(v) && v.every(x => typeof x === 'number') ? (v as number[]) : null)

/** Pure: builds the info map from raw rows (rounds columns + round_official_results rows). */
export function parseEarlyFinish(roundRows: unknown[], resultRows: unknown[]): Map<string, EarlyRoundInfo> {
  const out = new Map<string, EarlyRoundInfo>()
  for (const raw of roundRows ?? []) {
    const r = raw as Record<string, unknown>
    const reason = normaliseEarlyReason(r.closed_early_reason)
    if (r.closed_early !== true || typeof r.id !== 'string' || !reason) continue
    out.set(r.id, {
      roundId: r.id, reason, note: normaliseEarlyNote(r.closed_early_note),
      officialHoles: typeof r.official_holes === 'number' ? r.official_holes : null,
      // Excluded unless explicitly included: only a literal true counts.
      countsTowardEvent: r.counts_toward_event === true,
      results: new Map(),
    })
  }
  for (const raw of resultRows ?? []) {
    const r = raw as Record<string, unknown>
    const info = typeof r.round_id === 'string' ? out.get(r.round_id) : undefined
    if (!info || typeof r.player_id !== 'string') continue
    const kind = r.result_kind === 'qualifying' ? 'qualifying' : r.result_kind === 'incomplete' ? 'incomplete' : null
    if (!kind) continue
    info.results.set(r.player_id, {
      playerId: r.player_id, kind,
      officialPoints: kind === 'qualifying' && typeof r.official_points === 'number' ? r.official_points : null,
      segmentPoints: kind === 'qualifying' ? toNums(r.segment_points) : null,
      segmentHoles: kind === 'qualifying' ? toNums(r.segment_holes) : null,
      actualPoints: typeof r.actual_points === 'number' ? r.actual_points : 0,
      holesPlayed: typeof r.holes_played === 'number' ? r.holes_played : 0,
      startHole: typeof r.start_hole === 'number' ? r.start_hole : 1,
    })
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Reads the finish-early info for the given rounds. Any failure (including migration 100 not applied) = no early rounds. */
export async function loadEarlyFinish(admin: Admin, roundIds: string[], tripId?: string): Promise<Map<string, EarlyRoundInfo>> {
  if (roundIds.length === 0) return new Map()
  try {
    let q = admin.from('rounds')
      .select('id, closed_early, closed_early_reason, closed_early_note, official_holes, counts_toward_event')
      .in('id', roundIds).eq('closed_early', true)
    if (tripId) q = q.eq('trip_id', tripId) // never read another event's rounds
    const rounds = await q
    if (rounds.error || !rounds.data || rounds.data.length === 0) return new Map()
    const ids = (rounds.data as { id: string }[]).map(r => r.id)
    const results = await admin.from('round_official_results')
      .select('round_id, player_id, result_kind, official_points, segment_points, segment_holes, actual_points, holes_played, start_hole')
      .in('round_id', ids)
    if (results.error) return new Map()
    return parseEarlyFinish(rounds.data, results.data ?? [])
  } catch { return new Map() }
}

export interface EarlyLabels {
  /** "Round Finished Early -- Weather" */
  title: string
  /** "Official 9-Hole Result" or "Not an official result" */
  result: string
  /** "Counts Toward Event Championship" or "Not Counted Toward Event Championship" */
  counting: string
}
export function earlyLabels(info: Pick<EarlyRoundInfo, 'reason' | 'officialHoles' | 'countsTowardEvent'>): EarlyLabels {
  return {
    title: `Round Finished Early — ${EARLY_REASON_LABEL[info.reason]}`,
    result: info.officialHoles ? `Official ${info.officialHoles}-Hole Result` : 'Not an official result',
    counting: info.countsTowardEvent ? 'Counts Toward Event Championship' : 'Not Counted Toward Event Championship',
  }
}

export interface NotRankedPlayer {
  playerId: string
  playerName: string
  /** Actual points across the championship-counted rounds (incomplete round at its actual points). Never zeroed. */
  totalPoints: number
  incompleteRoundIds: string[]
}

export interface EarlyAdjustment {
  /** Same shape as the input; feed straight into computeCumulativeStandings. */
  results: RoundPlayerResult[][]
  /** Players excluded from the ranking because they are incomplete in a championship-counted round. */
  notRanked: NotRankedPlayer[]
  /** Finished-early rounds that do not count toward the championship. */
  excludedRoundIds: string[]
  /** Finished-early rounds that DO count (official nine-hole results). */
  countedEarlyRoundIds: string[]
}

/**
 * Adapts per-round results (index-aligned with roundIds) for the championship. Input is never mutated.
 * With no finished-early round this returns the input unchanged (same arrays), so normal events behave exactly as before.
 */
export function adjustForEarlyFinish(perRound: RoundPlayerResult[][], roundIds: string[], early: Map<string, EarlyRoundInfo>): EarlyAdjustment {
  const excludedRoundIds: string[] = []
  const countedEarlyRoundIds: string[] = []
  if (early.size === 0 || !roundIds.some(id => early.has(id))) {
    return { results: perRound, notRanked: [], excludedRoundIds, countedEarlyRoundIds }
  }

  const incompleteBy = new Map<string, Set<string>>()
  const countedIdx: number[] = []
  const adjusted = perRound.map((list, idx) => {
    const id = roundIds[idx]
    const info = early.get(id)
    if (!info) { countedIdx.push(idx); return list }
    if (!info.countsTowardEvent) { excludedRoundIds.push(id); return [] as RoundPlayerResult[] }
    countedEarlyRoundIds.push(id); countedIdx.push(idx)
    const kept: RoundPlayerResult[] = []
    for (const r of list) {
      const res = info.results.get(r.playerId)
      if (res && res.kind === 'qualifying' && res.officialPoints !== null) {
        kept.push({ ...r, roundPoints: res.officialPoints, holePoints: res.segmentPoints ?? [] })
      } else {
        const set = incompleteBy.get(r.playerId) ?? new Set<string>(); set.add(id); incompleteBy.set(r.playerId, set)
      }
    }
    return kept
  })

  const notRanked: NotRankedPlayer[] = []
  if (incompleteBy.size > 0) {
    for (const [playerId, rounds] of incompleteBy) {
      let name = 'Player', total = 0
      for (const idx of countedIdx) {
        const orig = perRound[idx].find(r => r.playerId === playerId)
        if (!orig) continue
        name = orig.playerName
        const info = early.get(roundIds[idx])
        total += info ? (info.results.get(playerId)?.actualPoints ?? orig.roundPoints) : orig.roundPoints
      }
      notRanked.push({ playerId, playerName: name, totalPoints: total, incompleteRoundIds: [...rounds] })
    }
    notRanked.sort((a, b) => b.totalPoints - a.totalPoints || a.playerName.localeCompare(b.playerName))
    // A not-ranked player must not appear in the ranking via their other rounds either.
    for (let i = 0; i < adjusted.length; i++) adjusted[i] = adjusted[i].filter(r => !incompleteBy.has(r.playerId))
  }
  return { results: adjusted, notRanked, excludedRoundIds, countedEarlyRoundIds }
}

/**
 * Per-round competition results (round winners / round standings / the round board).
 * Normal round: unchanged. Finished early with an official result: qualifying players only, on their official points
 * (incomplete players are never ranked and never "win"). Finished early without an official result: nobody ranked.
 */
export function roundCompetitionResults(results: RoundPlayerResult[], info: EarlyRoundInfo | undefined): RoundPlayerResult[] {
  if (!info) return results
  if (!info.officialHoles) return []
  const out: RoundPlayerResult[] = []
  for (const r of results) {
    const res = info.results.get(r.playerId)
    if (res && res.kind === 'qualifying' && res.officialPoints !== null) out.push({ ...r, roundPoints: res.officialPoints, holePoints: res.segmentPoints ?? [] })
  }
  return out
}

// ── Server-side service (routes call these; all decisions are made in the database transaction) ──────────

export interface SnapshotRow {
  scorecard_id: string; player_id: string; start_hole: number; holes_played: number; actual_points: number
  playing_handicap: number | null; segment_holes: number[] | null; segment_points: number[] | null
  official_points: number | null; result_kind: 'qualifying' | 'incomplete'
}

/** Maps a database exception (raised by migration 100) to a safe HTTP status and message. Never leaks SQL text. */
export function mapEarlyFinishError(err: { message?: string; code?: string } | null | undefined): { status: number; error: string; code: string } {
  const msg = String(err?.message ?? '')
  const known: [string, number, string][] = [
    ['ROUND_NOT_FOUND', 404, 'Round not found.'],
    ['ROUND_NOT_ACTIVE', 409, 'Only a round that is in play can be finished early. If it was already finished, refresh the page.'],
    ['INVALID_REASON', 400, 'Choose a reason: Weather / course conditions, Safety / emergency, or Other.'],
    ['NOTE_TOO_LONG', 400, `Keep the note to ${EARLY_NOTE_MAX} characters or fewer.`],
    ['INVALID_OFFICIAL_HOLES', 400, 'The official result must be a nine-hole result.'],
    ['ROUND_TOO_SHORT_FOR_OFFICIAL_HOLES', 400, 'This round does not have enough holes for a nine-hole result.'],
    ['INCLUSION_NEEDS_OFFICIAL_RESULT', 400, 'A round can only count toward the championship if it has an official nine-hole result.'],
    ['NO_QUALIFYING_PLAYERS', 409, 'No player has a valid nine-hole result, so this round cannot count toward the championship.'],
    ['MIXED_NINES_ACK_REQUIRED', 409, 'Groups played different nines. Please confirm you accept that before counting this round toward the championship.'],
    ['ROUND_NOT_FINISHED_EARLY', 409, 'This round was not finished early.'],
    ['INVALID_INCLUSION', 400, 'Choose whether the round counts toward the championship.'],
    ['INCLUSION_UNCHANGED', 409, 'That is already the current setting.'],
    ['NO_OFFICIAL_RESULTS_TO_REFRESH', 409, 'This round has no official nine-hole results to refresh.'],
  ]
  for (const [code, status, error] of known) if (msg.includes(code)) return { status, error, code }
  if (err?.code === '42883' || err?.code === 'PGRST202' || /does not exist|could not find the function|schema cache/i.test(msg)) {
    return { status: 503, error: 'Finish Round Early is not available yet — a database update is pending. Nothing has been changed.', code: 'MIGRATION_PENDING' }
  }
  return { status: 500, error: 'Could not complete that. Nothing has been changed — please try again.', code: 'UNKNOWN' }
}

export interface PreviewPlayer {
  playerId: string; name: string; kind: 'qualifying' | 'incomplete'
  holesPlayed: number; actualPoints: number; officialPoints: number | null; startHole: number
}
export interface EarlyFinishPreview {
  roundId: string
  qualifying: number; incomplete: number
  mixedNines: boolean
  /** Distinct nines played (e.g. ["1-9","10-18"]), only meaningful when there are qualifying players. */
  players: PreviewPlayer[]
  /** Other rounds of the event that this does NOT touch. */
  upcomingRoundsUntouched: number
}

/** Pure: summarises snapshot rows for the organiser's preview. */
export function summariseSnapshot(rows: SnapshotRow[], names: Map<string, string>, mixed: boolean, upcomingRounds: number, roundId: string): EarlyFinishPreview {
  const players: PreviewPlayer[] = rows.map(r => ({
    playerId: r.player_id, name: names.get(r.player_id) ?? 'Player', kind: r.result_kind,
    holesPlayed: r.holes_played, actualPoints: r.actual_points,
    officialPoints: r.result_kind === 'qualifying' ? r.official_points : null, startHole: r.start_hole,
  })).sort((a, b) => (a.kind === b.kind ? (b.officialPoints ?? b.actualPoints) - (a.officialPoints ?? a.actualPoints) : a.kind === 'qualifying' ? -1 : 1) || a.name.localeCompare(b.name))
  return {
    roundId, qualifying: players.filter(p => p.kind === 'qualifying').length, incomplete: players.filter(p => p.kind === 'incomplete').length,
    mixedNines: mixed, players, upcomingRoundsUntouched: upcomingRounds,
  }
}

export interface SnapshotDiff { changed: string[]; added: string[]; removed: string[]; stale: boolean }
/** Pure: how a fresh snapshot differs from the frozen one (drives the "potentially outdated" flag and the refresh preview). */
export function diffSnapshots(stored: EarlyPlayerResult[], fresh: SnapshotRow[]): SnapshotDiff {
  const s = new Map(stored.map(r => [r.playerId, r]))
  const f = new Map(fresh.map(r => [r.player_id, r]))
  const changed: string[] = [], added: string[] = [], removed: string[] = []
  for (const [id, fr] of f) {
    const st = s.get(id)
    if (!st) { added.push(id); continue }
    const same = st.kind === fr.result_kind && st.officialPoints === fr.official_points && st.holesPlayed === fr.holes_played
      && st.actualPoints === fr.actual_points && JSON.stringify(st.segmentPoints) === JSON.stringify(fr.segment_points) && JSON.stringify(st.segmentHoles) === JSON.stringify(fr.segment_holes)
    if (!same) changed.push(id)
  }
  for (const id of s.keys()) if (!f.has(id)) removed.push(id)
  return { changed, added, removed, stale: changed.length + added.length + removed.length > 0 }
}

export interface FinishEarlyInput {
  reason: unknown; note: unknown; countsTowardEvent: unknown; officialResult: unknown; acknowledgeMixedNines: unknown
}
/** Pure: validates request fields before touching the database. `counts` defaults to NO and must be a literal true to include. */
export function parseFinishEarlyInput(b: FinishEarlyInput): { ok: true; reason: EarlyReason; note: string | null; counts: boolean; officialHoles: 9 | null; ackMixed: boolean } | { ok: false; error: string } {
  const reason = normaliseEarlyReason(b.reason)
  if (!reason) return { ok: false, error: 'Choose a reason: Weather / course conditions, Safety / emergency, or Other.' }
  if (typeof b.note === 'string' && b.note.trim().length > EARLY_NOTE_MAX) return { ok: false, error: `Keep the note to ${EARLY_NOTE_MAX} characters or fewer.` }
  if (b.officialResult !== 'nine_hole' && b.officialResult !== 'none') return { ok: false, error: 'Choose the official result for this round.' }
  const officialHoles = b.officialResult === 'nine_hole' ? 9 : null
  const counts = b.countsTowardEvent === true
  if (counts && officialHoles === null) return { ok: false, error: 'A round can only count toward the championship if it has an official nine-hole result.' }
  return { ok: true, reason, note: normaliseEarlyNote(b.note), counts, officialHoles, ackMixed: b.acknowledgeMixedNines === true }
}

async function namesFor(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await admin.from('profiles').select('id, full_name').in('id', ids)
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? 'Player']))
}

export type ServiceResult = { status: number; body: Record<string, unknown> }
const fail = (e: { message?: string; code?: string } | null | undefined): ServiceResult => { const m = mapEarlyFinishError(e); return { status: m.status, body: { error: m.error, code: m.code } } }

/** Read-only preview for an ACTIVE round. Writes nothing. */
export async function previewFinishEarly(admin: Admin, tripId: string, roundId: string): Promise<ServiceResult> {
  const round = await admin.from('rounds').select('id, status, trip_id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!round.data) return { status: 404, body: { error: 'Round not found.' } }
  if (round.data.status !== 'active') return { status: 409, body: { error: 'Only a round that is in play can be finished early.', code: 'ROUND_NOT_ACTIVE' } }
  const snap = await admin.rpc('round_official_snapshot', { p_round_id: roundId, p_official_holes: 9 })
  if (snap.error) return fail(snap.error)
  const mixedRes = await admin.rpc('official_snapshot_is_mixed', { p_round_id: roundId, p_official_holes: 9 })
  const rows = (snap.data ?? []) as SnapshotRow[]
  const siblings = await admin.from('rounds').select('id, status').eq('trip_id', tripId)
  const upcoming = ((siblings.data ?? []) as { status: string }[]).filter(r => r.status === 'upcoming').length
  const names = await namesFor(admin, rows.map(r => r.player_id))
  return { status: 200, body: { preview: summariseSnapshot(rows, names, mixedRes.error ? false : mixedRes.data === true, upcoming, roundId) } }
}

/** The single atomic write: the database function finalises the round, records the decisions, snapshots and audit together. */
export async function finishRoundEarly(admin: Admin, p: { tripId: string; roundId: string; actorId: string; body: FinishEarlyInput }): Promise<ServiceResult> {
  const input = parseFinishEarlyInput(p.body)
  if (!input.ok) return { status: 400, body: { error: input.error } }
  const round = await admin.from('rounds').select('id, status').eq('id', p.roundId).eq('trip_id', p.tripId).maybeSingle()
  if (!round.data) return { status: 404, body: { error: 'Round not found.' } }
  if (round.data.status !== 'active') return { status: 409, body: { error: 'Only a round that is in play can be finished early.', code: 'ROUND_NOT_ACTIVE' } }
  const res = await admin.rpc('finish_round_early', {
    p_round_id: p.roundId, p_actor: p.actorId, p_reason: input.reason, p_note: input.note,
    p_counts: input.counts, p_official_holes: input.officialHoles, p_ack_mixed: input.ackMixed,
  })
  if (res.error) return fail(res.error)
  // Side-game winners are finalised exactly as a normal close does (idempotent, best-effort). Unplayed side-game holes
  // simply have no winner; nothing is invented. The event is NEVER auto-completed and no champion is ever declared here.
  const fin = await admin.rpc('finalize_side_comp_winners', { p_round_id: p.roundId })
  if (fin.error) console.error('[finish-early] finalize_side_comp_winners failed', fin.error)
  return { status: 200, body: { ok: true, result: res.data } }
}

/** Stored-vs-fresh comparison for a finished-early round: the "potentially outdated" flag and the refresh preview. */
export async function earlyResultsStatus(admin: Admin, tripId: string, roundId: string): Promise<ServiceResult> {
  const round = await admin.from('rounds').select('id, closed_early, closed_early_reason, closed_early_note, official_holes, counts_toward_event').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!round.data) return { status: 404, body: { error: 'Round not found.' } }
  if (!round.data.closed_early) return { status: 200, body: { finishedEarly: false } }
  const info = (await loadEarlyFinish(admin, [roundId], tripId)).get(roundId)
  const labels = info ? earlyLabels(info) : null
  const common = { finishedEarly: true, reason: normaliseEarlyReason(round.data.closed_early_reason), note: normaliseEarlyNote(round.data.closed_early_note), labels, countsTowardEvent: round.data.counts_toward_event === true }
  if (!round.data.official_holes) return { status: 200, body: { ...common, officialHoles: null, stale: false, changed: [], added: [], removed: [] } }
  const fresh = await admin.rpc('round_official_snapshot', { p_round_id: roundId, p_official_holes: round.data.official_holes })
  if (fresh.error || !info) return { status: 200, body: { ...common, officialHoles: round.data.official_holes, stale: false, unknown: true } }
  const diff = diffSnapshots([...info.results.values()], (fresh.data ?? []) as SnapshotRow[])
  const names = await namesFor(admin, [...diff.changed, ...diff.added, ...diff.removed])
  const label = (ids: string[]) => ids.map(id => ({ playerId: id, name: names.get(id) ?? 'Player' }))
  return { status: 200, body: { ...common, officialHoles: round.data.official_holes, stale: diff.stale, changed: label(diff.changed), added: label(diff.added), removed: label(diff.removed) } }
}

export async function setEarlyInclusion(admin: Admin, p: { tripId: string; roundId: string; actorId: string; counts: unknown; ackMixed: unknown }): Promise<ServiceResult> {
  if (typeof p.counts !== 'boolean') return { status: 400, body: { error: 'Choose whether the round counts toward the championship.' } }
  const round = await admin.from('rounds').select('id').eq('id', p.roundId).eq('trip_id', p.tripId).maybeSingle()
  if (!round.data) return { status: 404, body: { error: 'Round not found.' } }
  const res = await admin.rpc('set_round_early_inclusion', { p_round_id: p.roundId, p_actor: p.actorId, p_counts: p.counts, p_ack_mixed: p.ackMixed === true })
  return res.error ? fail(res.error) : { status: 200, body: { ok: true, result: res.data } }
}

export async function refreshEarlyResults(admin: Admin, p: { tripId: string; roundId: string; actorId: string }): Promise<ServiceResult> {
  const round = await admin.from('rounds').select('id').eq('id', p.roundId).eq('trip_id', p.tripId).maybeSingle()
  if (!round.data) return { status: 404, body: { error: 'Round not found.' } }
  const res = await admin.rpc('refresh_round_official_results', { p_round_id: p.roundId, p_actor: p.actorId })
  return res.error ? fail(res.error) : { status: 200, body: { ok: true, result: res.data } }
}
