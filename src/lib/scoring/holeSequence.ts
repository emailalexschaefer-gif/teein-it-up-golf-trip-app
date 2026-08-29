/**
 * Starting Tee support — the single authoritative function that turns
 * (hole count, starting tee) into an ordered PLAY sequence of physical
 * hole numbers.
 *
 * The core principle this whole feature rests on: physical hole number
 * and play-order position are different concepts. Hole 10 is always
 * Hole 10 — its own real par, stroke index, and distance never change —
 * it just becomes position 1 in the played sequence for a back-nine or
 * 10th-tee start. Nothing anywhere renumbers holes; this function only
 * ever reorders them.
 *
 * Deliberately separate from Shotgun Start (start_type='shotgun',
 * round_group_starting_holes) — that's a genuinely different feature
 * (per-GROUP arbitrary starting hole, same round). Starting Tee is a
 * single, round-level value applying uniformly to every player. The two
 * are not merged into one mechanism, per the explicit instruction not
 * to touch shotgun's existing architecture.
 */
export type StartingHoleNumber = 1 | 10

/**
 * Returns the physical hole numbers in PLAY order for a round of the
 * given hole count, starting at the given tee.
 *
 *   (9, 1)  -> [1..9]
 *   (9, 10) -> [10..18]
 *   (18, 1) -> [1..18]
 *   (18, 10) -> [10..18, 1..9]
 *
 * A 9-hole round starting at the 10th tee is NOT circular — it's a
 * contiguous run of 9 holes (10 through 18) that simply ends there, the
 * same as a normal front-nine round ending at 9. Only the 18-hole/10th
 * case wraps back to hole 1, because it's the only combination that
 * plays every hole on the course starting partway through it.
 */
export function computeHolePlayOrder(holeCount: 9 | 18, startingHoleNumber: StartingHoleNumber): number[] {
  if (startingHoleNumber === 1) {
    return Array.from({ length: holeCount }, (_, i) => i + 1)
  }
  // startingHoleNumber === 10
  if (holeCount === 9) {
    return Array.from({ length: 9 }, (_, i) => i + 10)
  }
  // 18 holes from the 10th: 10..18, then 1..9.
  const back = Array.from({ length: 9 }, (_, i) => i + 10)
  const front = Array.from({ length: 9 }, (_, i) => i + 1)
  return [...back, ...front]
}

/**
 * Reorders any array of hole-like rows (already fetched from the
 * database in whatever order) into PLAY order, using
 * computeHolePlayOrder above as the single source of truth for what
 * that order is. Used by the holes-fetch API route so navigation code
 * downstream (which walks the array purely by position, never by
 * hole_number value) receives holes already in the correct sequence —
 * no navigation/completion/scoring code needs to know Starting Tee
 * exists at all.
 *
 * Rows whose hole_number isn't part of the expected sequence (shouldn't
 * happen for a correctly-configured round, but defensive rather than
 * silently dropping data) are appended at the end in their original
 * relative order, so nothing is ever lost even if the round's actual
 * holes don't perfectly match its own configured starting tee/count.
 */
export function orderHolesByPlaySequence<T extends { hole_number: number }>(
  holes: T[], holeCount: 9 | 18, startingHoleNumber: StartingHoleNumber,
): T[] {
  const playOrder = computeHolePlayOrder(holeCount, startingHoleNumber)
  const byHoleNumber = new Map<number, T>()
  for (const h of holes) if (!byHoleNumber.has(h.hole_number)) byHoleNumber.set(h.hole_number, h)
  const ordered: T[] = []
  for (const hn of playOrder) {
    const h = byHoleNumber.get(hn)
    if (h) { ordered.push(h); byHoleNumber.delete(hn) }
  }
  // Anything left over (unexpected hole_number not in the play sequence)
  // — preserve it rather than silently drop it, in whatever relative
  // order it was originally given.
  for (const h of holes) if (byHoleNumber.has(h.hole_number)) { ordered.push(h); byHoleNumber.delete(h.hole_number) }
  return ordered
}
