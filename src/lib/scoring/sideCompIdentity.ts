/**
 * Consolidated Test + Fix brief (1 Sep) — items 2 and 3 regression
 * hardening. Both are small decisions previously inline in JSX/component
 * bodies (SideCompEntryPanel.tsx, SelfMarkerScoreShell.tsx) — extracted
 * here purely so the actual bug found in each can have a real,
 * behaviour-level regression test, not because either needed a bigger
 * refactor. Each function's own comment names exactly which bug it
 * fixes and where it's actually called from in the app.
 */

/**
 * Item 2 — "Darren Lappen · pending verification" for a claim that was
 * actually for Razzle Dazzle. Root cause: the celebratory prompt used
 * the authenticated device operator's own name instead of the actual
 * competitor's. This is the exact resolution now used at the real call
 * site (SideCompEntryPanel.tsx's submit handler) — the competitor is
 * always whoever was selected via "Result for," never the caller.
 */
export function resolveCompetitorDisplayName(params: {
  selectedPlayerId: string
  currentUserId: string
  groupMembers: { id: string; name: string }[]
}): string {
  const { selectedPlayerId, currentUserId, groupMembers } = params
  const found = groupMembers.find(m => m.id === selectedPlayerId)?.name
  if (found) return found
  return selectedPlayerId === currentUserId ? 'You' : 'Player'
}

/**
 * Item 3 — a Side Game photo taken on a SECOND visit to an already-
 * claimed comp (after navigating away and back) uploaded with no
 * side_comp_entries link at all, producing a generic, unlinked Moment
 * instead of the combined photo+leader story. Root cause: the entry ID
 * passed to MomentCapture only ever came from a fresh-submission-only
 * value (lastResultEntryId), never from the value restored when an
 * existing claim is reloaded (restoredEntryId). This is the exact
 * fallback now used at the real call site (SideCompEntryPanel.tsx's
 * MomentCapture prop).
 */
export function resolveSideCompMomentEntryId(params: {
  lastResultEntryId: string | null
  restoredEntryId: string | null
}): string | null {
  return params.lastResultEntryId ?? params.restoredEntryId ?? null
}
