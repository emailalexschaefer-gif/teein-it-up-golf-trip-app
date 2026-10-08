/**
 * resolveSideGameWinner -- V1.12 (7 Oct). Pure, testable priority
 * logic for Event Memories' Side Game winner resolution, extracted
 * specifically so it can be exercised with plain data in tests,
 * independent of any database call.
 *
 * ROOT CAUSE this exists to fix (see the V1.11 comment in
 * eventMemoryData.ts for the original trace): the slideshow only ever
 * read side_comps.official_winner_entry_id, a column written
 * exclusively by finalize_side_comp_winners() at round-close time.
 * The live Side Games screen (computeRoundSideGames.ts) shows a
 * winner the moment an individual Side Game is complete, independent
 * of round-close status -- so a round that is genuinely still open,
 * with one or more individually-complete Side Games, showed those
 * winners live while Event Memories showed none at all.
 *
 * PRIORITY, exactly as specified:
 *   1. The round is formally finalised (rounds.status === 'completed'
 *      -- the existing, canonical field; confirmed as authoritative
 *      because it's the exact same status value the round-close route
 *      sets at the same moment it calls finalize_side_comp_winners(),
 *      and the same field get_my_golf_summary()'s own self-healing
 *      reconciliation already treats as the finalisation gate. No new
 *      flag was introduced.).
 *        a. official_winner_entry_id is set -> use the official winner.
 *        b. official_winner_entry_id is null -> AUTHORITATIVE NO
 *           WINNER. Stop. The fallback never runs here -- a formally
 *           finalised Side Game with no official winner was a
 *           deliberate outcome (no valid qualifying result at
 *           close time), and Event Memories must not resurrect a
 *           provisional leader over that deliberate result.
 *   2. The round is NOT yet finalised (status !== 'completed'):
 *        a. official_winner_entry_id is set anyway (an edge case --
 *           self-healing finalisation, or a future code path, could
 *           in principle set it before the round's own status flips)
 *           -> official state always wins when present, regardless of
 *           round status.
 *        b. Otherwise, fall back to the EXACT completion/winner signal
 *           the live Side Games screen already computes
 *           (computeRoundSideGames.ts's own `winner` field -- itself
 *           already `isHoleComplete(...) ? currentLeader : null`, so
 *           "complete" and "no current leader became a winner" are
 *           never redefined here). A null fallback winner (hole not
 *           complete yet, or complete with no qualifying result at
 *           all) means no winner, full stop -- never an in-progress
 *           leader.
 *
 * TIE HANDLING: mirrors the live Side Games screen exactly, by
 * construction -- computeRoundSideGames.ts's own `winner` field is
 * already a single entry, not an array, for every comp type (see the
 * delivery report's "co-winner findings" section for the full
 * explanation of why, and the pre-existing divergence this surfaced
 * between the official SQL finalisation algorithm and this live
 * computation). No co-winner/tie-array handling was added here,
 * because there is none to mirror -- the source being mirrored never
 * produces one.
 */

export interface ResolvedSideGameWinner {
  sideCompId: string
  roundId: string
  compType: string
  label: string
  holeNumber: number | null
  winnerPlayerId: string | null
  winnerName: string | null
}

export interface SideCompForResolution {
  id: string
  roundId: string
  compType: string
  label: string
  holeNumber: number | null
  officialWinnerPlayerId: string | null
  officialWinnerName: string | null
}

/** The one piece of live-screen data this needs per Side Game --
 *  exactly computeRoundSideGames.ts's own `winner` field, nothing
 *  else (never `currentLeader` on its own, which could be in-progress). */
export interface FallbackWinnerSignal {
  playerId: string
  playerName: string
}

/**
 * Resolves one Side Game's winner for Event Memories purposes.
 * roundIsFinalised must be exactly `round.status === 'completed'` --
 * the canonical field, passed in rather than re-derived here so this
 * function stays a pure function of its inputs.
 */
export function resolveSideGameWinner(
  comp: SideCompForResolution,
  roundIsFinalised: boolean,
  fallbackWinner: FallbackWinnerSignal | null,
): ResolvedSideGameWinner {
  const base = { sideCompId: comp.id, roundId: comp.roundId, compType: comp.compType, label: comp.label, holeNumber: comp.holeNumber }

  if (comp.officialWinnerPlayerId !== null) {
    // Official state always wins when present, whether or not the
    // round has formally closed yet (the edge case in priority 2a).
    return { ...base, winnerPlayerId: comp.officialWinnerPlayerId, winnerName: comp.officialWinnerName }
  }

  if (roundIsFinalised) {
    // Priority 1b -- authoritative no winner. The fallback never runs.
    return { ...base, winnerPlayerId: null, winnerName: null }
  }

  // Priority 2b -- the pre-finalisation completed-Side-Game fallback,
  // using exactly the live screen's own resolved winner signal.
  if (fallbackWinner) {
    return { ...base, winnerPlayerId: fallbackWinner.playerId, winnerName: fallbackWinner.playerName }
  }
  return { ...base, winnerPlayerId: null, winnerName: null }
}
