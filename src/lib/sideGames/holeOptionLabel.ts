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
