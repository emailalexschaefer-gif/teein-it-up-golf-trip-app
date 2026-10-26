// Field test 26 Oct -- the playing-partner panel must follow LIVE data, never the server-rendered snapshot.
// Root cause of "Waiting for TEST ... stuck until I leave and reopen": the panel gates read the page's
// `markedScorecard` PROP (frozen at first render) while the name came from the live 7-second query, so once the
// pairing existed the screen showed the waiting card forever. These helpers take only live values.

export interface PartnerPanelInput {
  requiresMarker: boolean
  isSharedDeviceScoring: boolean
  /** true when the LIVE query currently resolves a marked scorecard */
  liveMarkedPresent: boolean
  partnerName: string | null
}

/** Show the partner scoring panel whenever the live data has a partner. */
export function showPartnerPanel(i: PartnerPanelInput): boolean {
  return (i.requiresMarker || i.isSharedDeviceScoring) && i.liveMarkedPresent && !!i.partnerName
}

/**
 * Small, self-clearing note shown above the partner panel while the partner has recorded no entries of their own.
 * It never hides or disables scoring (the marker can still enter the partner's score) and disappears by itself once
 * the live refresh sees the partner's first entry. Not shown for a paper player on a shared device (they never
 * score themselves).
 */
export function partnerNotStartedNote(i: { isSharedDeviceScoring: boolean; partnerName: string | null; partnerSelfEntryCount: number }): string | null {
  if (i.isSharedDeviceScoring || !i.partnerName || i.partnerSelfEntryCount > 0) return null
  return `${i.partnerName} hasn't started scoring yet. This updates automatically.`
}
