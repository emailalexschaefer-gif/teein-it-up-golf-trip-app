import type { Highlight } from './makersBreakers'

/**
 * Makers & Breakers Publish Lifecycle — My Golf consumption.
 *
 * This is the ONLY logic that decides "does this published highlight
 * belong to this player's personal Round N story." It never
 * recalculates a highlight — it only filters the already-published,
 * already-organiser-selected set (item 12's "one qualification engine
 * -> one organiser selection -> one published result -> many views").
 *
 * Personal highlights (scope='individual') match by playerId directly
 * — the same field the engine already populates.
 *
 * Group highlights (scope='group') match by the CALLER's own
 * round-specific groupId, not any mutable current trip grouping — the
 * caller is responsible for passing the player's round-specific
 * groupId (from scorecards.group_id for that exact round), not a
 * live trip_members.group_id, matching the explicit "use the round-
 * specific group snapshot, not current mutable trip grouping"
 * requirement everywhere else in this codebase already follows.
 */
export function filterPublishedHighlightsForPlayer(
  highlights: Highlight[],
  playerId: string,
  playerRoundGroupId: string | null,
): { personal: Highlight[]; group: Highlight[] } {
  const personal = highlights.filter(h => h.scope === 'individual' && h.playerId === playerId)
  const group = playerRoundGroupId
    ? highlights.filter(h => h.scope === 'group' && h.groupId === playerRoundGroupId)
    : []
  return { personal, group }
}
