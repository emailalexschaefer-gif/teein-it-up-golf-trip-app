// The ONE celebration trigger: the Overall Champion slide, and nothing else.
// The Top 5 Final Results ("leaderboard") and the closing slide get background
// music only -- no applause, no confetti, no celebration animation.
export function isCelebrationSlide(slide: { kind: string } | undefined): boolean {
  return slide?.kind === 'champion'
}
