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
 * V7: the "hasn't started scoring yet" box is hidden as soon as the playing partner is DETECTED (a name resolves from
 * the live data) -- not only after their first score. Detecting the partner is what the player was waiting for; whether
 * the partner has scored yet is shown by the per-hole status indicators instead. Kept as a function (always null once a
 * partner exists, and for a shared-device paper player) so existing call sites stay valid; it can only return a note
 * when there is no partner name, which the caller never renders.
 */
export function partnerNotStartedNote(i: { isSharedDeviceScoring: boolean; partnerName: string | null; partnerSelfEntryCount: number }): string | null {
  void i
  return null
}
