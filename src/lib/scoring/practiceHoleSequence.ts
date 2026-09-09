export type HolesChoice = 9 | 18
export type NineSelection = 'front' | 'back' | null | undefined
export type StartingHole = 1 | 10 | null | undefined

export type PracticeSequenceResult =
  | { ok: true; holeSequence: number[] }
  | { ok: false; error: string }

/**
 * P0 fix (9 Sep) -- extracted from /api/practice/create/route.ts's
 * inline logic so the exact four canonical configurations the brief
 * lists can be tested directly, independent of the Zod/HTTP layer
 * (which cannot be exercised in this sandbox at all -- no `zod`
 * package is installed anywhere here, and route.ts files cannot be
 * imported directly outside a real Next.js runtime). This function is
 * the actual product logic the route calls; the route itself is now a
 * thin wrapper that validates the raw shape (via Zod) and then calls
 * this.
 *
 * Deliberately accepts nineSelection/startingHole typed to allow
 * null | undefined (not just their "real" values) -- this is the
 * exact shape the fixed Zod schema now produces (nullable().optional()),
 * and reproducing that here is what lets a test directly exercise the
 * former bug (an explicit null reaching this function) without a live
 * Zod parse.
 */
export function buildPracticeHoleSequence(holes: HolesChoice, nineSelection: NineSelection, startingHole: StartingHole): PracticeSequenceResult {
  if (holes === 9) {
    if (nineSelection !== 'front' && nineSelection !== 'back') {
      return { ok: false, error: 'Select Front 9 or Back 9.' }
    }
    return {
      ok: true,
      holeSequence: nineSelection === 'front'
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
        : [10, 11, 12, 13, 14, 15, 16, 17, 18],
    }
  }
  if (startingHole !== 1 && startingHole !== 10) {
    return { ok: false, error: 'Select 1st Tee or 10th Tee.' }
  }
  return {
    ok: true,
    holeSequence: startingHole === 1
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      : [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  }
}
