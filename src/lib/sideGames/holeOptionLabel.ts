/**
 * 18 Oct field test -- the Side Game hole picker shows each hole's par
 * ("Hole 3 — Par 3") so an organiser can spot suitable Nearest the Pin /
 * Longest Drive holes. Pars come ONLY from the course data frozen into the
 * round (library_holes_snapshot) -- the same source scoring uses. A round
 * set up manually has no hole data, so it shows the plain "Hole 3": a par is
 * never guessed or invented.
 */
export function holeOptionLabel(
  holeNumber: number,
  snapshot: { hole_number: number; par: number }[] | null | undefined,
): string {
  const par = snapshot?.find(h => h.hole_number === holeNumber)?.par
  return typeof par === 'number' && Number.isFinite(par) && par > 0
    ? `Hole ${holeNumber} — Par ${par}`
    : `Hole ${holeNumber}`
}

/**
 * Field test 26 Oct (Round 2 showed holes without pars). How much of this round's playable holes have a par in its own
 * frozen course snapshot? 'none' / 'partial' drive a visible setup warning instead of a silent plain "Hole 3".
 * Never reads another round's data and never invents a par.
 */
export function parCoverage(
  holeNumbers: number[],
  snapshot: { hole_number: number; par: number }[] | null | undefined,
): 'complete' | 'partial' | 'none' {
  const have = holeNumbers.filter(n => {
    const par = snapshot?.find(h => h.hole_number === n)?.par
    return typeof par === 'number' && Number.isFinite(par) && par > 0
  }).length
  if (holeNumbers.length === 0 || have === 0) return 'none'
  return have === holeNumbers.length ? 'complete' : 'partial'
}

export const PAR_COVERAGE_WARNING =
  "This round has no course hole data, so hole pars can't be shown. Choose this round's course and tees from the Course Library above (each round keeps its own) to see each hole's par."
export const PAR_PARTIAL_WARNING =
  "This round's course data is missing pars for some holes. Re-select this round's course and tees above to refresh it."
