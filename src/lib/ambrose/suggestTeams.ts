// Package 4 / M2 -- slot-based team SUGGESTIONS. PURE. A suggestion is never a stored relationship: the organiser reviews it and saves it
// through save_round_team_entry, which writes explicit roster rows. Re-running or re-ordering never changes a saved team, and players who are
// already on a saved team are left alone (so existing scores can never be re-assigned by a changed group order).
//
// "Slot" order is simply the order the organiser sees the group's players in on the setup screen (it is not stored anywhere).
// Defaults (Darren's convention): two-person Ambrose -> slots 1+2 = Team A, 3+4 = Team B; four-person Ambrose -> all four = one team.
// Alternate Shot (pairs, same 1+2 / 3+4 convention) is a later phase and is NOT accepted here.

export type SuggestFormat = 'ambrose_2' | 'ambrose_4'
export interface SuggestGroup { groupId: string; groupName: string; playerIdsInSlotOrder: string[] }
export interface SuggestedTeam {
  /** Unique within the event, e.g. "Group 1 · Team A". */
  name: string
  /** Visible text label shown with the colour (colour alone is never enough). */
  label: 'Team A' | 'Team B' | 'Team'
  /** Index into the UI's shade palette; the palette itself lives in the UI and must also carry the text label. */
  shadeIndex: number
  groupId: string
  slots: number[]            // 1-based slot numbers used
  playerIds: string[]
}
export interface GroupSuggestion { groupId: string; teams: SuggestedTeam[]; unassigned: string[]; alreadyAssigned: string[]; issues: string[] }

export function suggestTeams(format: SuggestFormat, groups: SuggestGroup[], alreadyAssignedPlayerIds: ReadonlySet<string> = new Set()): GroupSuggestion[] {
  const size = format === 'ambrose_2' ? 2 : 4
  const seen = new Set<string>()
  return groups.map(g => {
    const issues: string[] = []
    const unique: { id: string; slot: number }[] = []
    const alreadyAssigned: string[] = []
    g.playerIdsInSlotOrder.forEach((id, i) => {
      if (seen.has(id)) { issues.push('A player appears in more than one group'); return }
      seen.add(id)
      if (alreadyAssignedPlayerIds.has(id)) alreadyAssigned.push(id)
      else unique.push({ id, slot: i + 1 })
    })
    const teams: SuggestedTeam[] = []
    const unassigned: string[] = []
    // Only take whole teams, in slot order, from the players who are not already on a saved team. A short remainder is NEVER padded or guessed.
    for (let i = 0; i + size <= unique.length; i += size) {
      const chunk = unique.slice(i, i + size)
      const n = teams.length
      const label: SuggestedTeam['label'] = size === 4 ? 'Team' : n === 0 ? 'Team A' : n === 1 ? 'Team B' : 'Team A'
      teams.push({
        name: size === 4 ? `${g.groupName} team` : `${g.groupName} · ${n % 2 === 0 ? 'Team A' : 'Team B'}${n >= 2 ? ` (${n + 1})` : ''}`,
        label, shadeIndex: n % 2, groupId: g.groupId, slots: chunk.map(c => c.slot), playerIds: chunk.map(c => c.id),
      })
    }
    const used = teams.reduce((a, t) => a + t.playerIds.length, 0)
    unassigned.push(...unique.slice(used).map(u => u.id))
    if (unassigned.length > 0) issues.push(`${unassigned.length} player${unassigned.length === 1 ? '' : 's'} left without a team — add or move players, or set the team by hand`)
    return { groupId: g.groupId, teams, unassigned, alreadyAssigned, issues }
  })
}

/** The organiser may release/confirm only when nobody is left unassigned and no structural issue remains. */
export function canConfirmTeams(s: GroupSuggestion[]): { ok: true } | { ok: false; reasons: string[] } {
  const reasons = s.flatMap(g => g.issues)
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}
