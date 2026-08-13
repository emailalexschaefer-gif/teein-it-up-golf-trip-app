/**
 * Pure logic for the Course Library v1 + Sprint 9 side-comp persistence
 * <-> readback round trip. Extracted specifically so this is unit-
 * tested, not just verified by reading — after a real regression where
 * side competitions vanished from Edit Trip (traced to a fragile,
 * previously-untested 3-level nested PostgREST embed through the
 * RLS-subject client; replaced with the flat query these functions
 * operate on).
 */

export interface SideCompRow {
  id: string
  round_id: string
  comp_type: string
  hole_number: number | null
  enabled: boolean
}

/**
 * Groups a flat side_comps query result by round_id — the exact
 * transformation src/app/(app)/trips/[tripId]/page.tsx applies to the
 * explicit, separate side_comps query that replaced the fragile nested
 * embed. Every row for a round must appear, regardless of how many
 * share the same comp_type — nothing here ever keys or dedupes by
 * comp_type, only by round_id + the row's own id.
 */
export function groupSideCompsByRound(rows: SideCompRow[]): Map<string, Omit<SideCompRow, 'round_id'>[]> {
  const byRound = new Map<string, Omit<SideCompRow, 'round_id'>[]>()
  for (const row of rows) {
    if (!byRound.has(row.round_id)) byRound.set(row.round_id, [])
    byRound.get(row.round_id)!.push({ id: row.id, comp_type: row.comp_type, hole_number: row.hole_number, enabled: row.enabled })
  }
  return byRound
}

export interface WizardSideCompPrefill { id: string; comp_type: string; hole_number: number }

/**
 * The exact filter/map TripDetailClient.tsx's editUrl construction
 * applies to a round's side_comps before they're serialised into the
 * wizard prefill payload. Only enabled rows with both a recognised
 * comp_type and a real hole_number are carried forward — this is a
 * defensive filter (an admin-disabled or malformed row shouldn't
 * silently corrupt the wizard), not a place instances get collapsed:
 * two rows of the same comp_type both pass through as two separate
 * entries, keyed by their own distinct id.
 */
export function toWizardSideCompPrefill(comps: Omit<SideCompRow, 'round_id'>[]): WizardSideCompPrefill[] {
  const KNOWN_TYPES = new Set(['nearest_pin', 'longest_drive', 'pros_approach', 'powerplay'])
  return comps
    .filter((c): c is Omit<SideCompRow, 'round_id'> & { hole_number: number } =>
      KNOWN_TYPES.has(c.comp_type) && c.enabled && c.hole_number != null)
    .map(c => ({ id: c.id, comp_type: c.comp_type, hole_number: c.hole_number }))
}
